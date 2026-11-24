import { describe, expect, test, vi } from "vitest";
import { createInspector } from "../../lib/inspect.js";

describe("createInspector", () => {
  test("builds a snapshot from asynchronous PostgreSQL queries", async () => {
    const adminGetRow = vi.fn((sql) => {
      const q = (sql?.toSQL ? sql.toSQL().sql : String(sql)).toLowerCase();
      if (q.includes("from \"users\"") || q.includes("from `users`") || q.includes("from users")) return Promise.resolve({ n: 2 });
      if (q.includes("from \"chats\"") || q.includes("from `chats`") || q.includes("from chats")) return Promise.resolve({ n: 1 });
      if (q.includes("from \"chat_messages\"") || q.includes("from `chat_messages`") || q.includes("from chat_messages")) return Promise.resolve({ n: 3 });
      if (q.includes("from \"chat_message_files\"") || q.includes("from `chat_message_files`") || q.includes("from chat_message_files"))
        return Promise.resolve({ n: 0 });
      return Promise.resolve({ n: 0 });
    });
    const adminGetAll = vi.fn((sql) => {
      const q = (sql?.toSQL ? sql.toSQL().sql : String(sql)).toLowerCase();
      if (q.includes("users")) {
        return Promise.resolve([{ id: 1, username: "alice" }]);
      }
      if (q.includes("chats")) {
        return Promise.resolve([{ id: 10, type: "group", name: "General" }]);
      }
      if (q.includes("chat_members")) {
        return Promise.resolve([
          { chat_id: 10, user_id: 1 },
          { chat_id: 10, user_id: 2 },
        ]);
      }
      return Promise.resolve([]);
    });
    const inspector = createInspector({
      fs: { statfsSync: vi.fn() },
      dataDir: "/data",
      adminGetRow,
      adminGetAll,
    });

    await expect(
      inspector.buildInspectSnapshot("all", 25),
    ).resolves.toMatchObject({
      kind: "all",
      counts: { users: 2, chats: 1, messages: 3, files: 0 },
      users: [{ id: 1, username: "alice" }],
      chats: [
        {
          id: 10,
          type: "group",
          name: "General",
          members: 2,
          member_ids: ["1", "2"],
          messages: 0,
        },
      ],
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // REGRESSION — migration 036 made chats/chat_members ids TEXT UUIDs. The
  // snapshot once mapped every chat id through Number() (NaN for a UUID),
  // so the members whereIn matched nothing and EVERY chat reported
  // members: 0 with an empty member_ids list.
  // ─────────────────────────────────────────────────────────────────────────
  test("groups chat members correctly under UUID chat/user ids", async () => {
    const CHAT_A = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const CHAT_B = "6ba7b811-9dad-11d1-80b4-00c04fd430c9";
    const USER_1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const USER_2 = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";
    const USER_3 = "3f2504e0-4f89-11d3-9a0c-0305e82c3303";

    const adminGetRow = vi.fn(() => Promise.resolve({ n: 0 }));
    const adminGetAll = vi.fn((sql) => {
      const q = (sql?.toSQL ? sql.toSQL().sql : String(sql)).toLowerCase();
      if (q.includes("chat_members")) {
        return Promise.resolve([
          { chat_id: CHAT_A, user_id: USER_1 },
          { chat_id: CHAT_A, user_id: USER_2 },
          { chat_id: CHAT_B, user_id: USER_3 },
        ]);
      }
      if (q.includes("chats")) {
        return Promise.resolve([
          { id: CHAT_A, type: "dm", name: "A" },
          { id: CHAT_B, type: "group", name: "B" },
        ]);
      }
      return Promise.resolve([]);
    });
    const inspector = createInspector({
      fs: { statfsSync: vi.fn() },
      dataDir: "/data",
      adminGetRow,
      adminGetAll,
    });

    const snapshot = await inspector.buildInspectSnapshot("chat", 25);
    const byId = new Map(snapshot.chats.map((c) => [c.id, c]));
    expect(byId.get(CHAT_A).members).toBe(2);
    expect(byId.get(CHAT_A).member_ids).toEqual([USER_1, USER_2]);
    expect(byId.get(CHAT_B).members).toBe(1);
    expect(byId.get(CHAT_B).member_ids).toEqual([USER_3]);
  });

  test("skips member rows with null chat/user references instead of crashing", async () => {
    const CHAT_A = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const USER_1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const adminGetRow = vi.fn(() => Promise.resolve({ n: 0 }));
    const adminGetAll = vi.fn((sql) => {
      const q = (sql?.toSQL ? sql.toSQL().sql : String(sql)).toLowerCase();
      if (q.includes("chat_members")) {
        return Promise.resolve([
          { chat_id: CHAT_A, user_id: USER_1 },
          { chat_id: CHAT_A, user_id: null },
          { chat_id: null, user_id: USER_1 },
        ]);
      }
      if (q.includes("chats")) {
        return Promise.resolve([{ id: CHAT_A, type: "dm", name: "A" }]);
      }
      return Promise.resolve([]);
    });
    const inspector = createInspector({
      fs: { statfsSync: vi.fn() },
      dataDir: "/data",
      adminGetRow,
      adminGetAll,
    });

    const snapshot = await inspector.buildInspectSnapshot("chat", 25);
    expect(snapshot.chats[0].member_ids).toEqual([USER_1]);
    expect(snapshot.chats[0].members).toBe(1);
  });
});
