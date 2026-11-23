import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// adminListCalls — the admin panel call-history report.
//
// Call logs are the plain-text "[[call:<type>:<status>[:<duration>]]]" messages
// the callManager writes into chat_messages (they are stored plaintext even
// when storage encryption is on, and user-typed look-alikes are encrypted, so
// the SQL prefix filter cannot be spoofed). Guarantees under test:
//   * every call log is listed with caller + chat + parsed type/status/duration
//   * regular messages (incl. encrypted look-alikes) never appear
//   * type / status / chat filters and pagination behave
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; this suite is SQLite-only.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-admincalls-"));
// Deterministic encryption so the look-alike assertion below is meaningful:
// with a key set, call-log bodies stay plaintext (system bodies) while the
// user-typed look-alike message is encrypted at rest.
process.env.STORAGE_ENCRYPTION_KEY = "admincalls-report-test-key";

const sync = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

const {
  createUser,
  createChat,
  addChatMember,
  createMessage,
  adminListCalls,
} = await import("../../db.js");

const callerId = await sync(
  createUser("acall-caller", "hash", "Caller", null, null, { role: "user" }),
);
const calleeId = await sync(
  createUser("acall-callee", "hash", "دریافت‌کننده", null, null, { role: "user" }),
);

const dmChatId = await sync(createChat("dm", "dm"));
await sync(addChatMember(dmChatId, callerId));
await sync(addChatMember(dmChatId, calleeId));

const groupChatId = await sync(createChat("Support Team", "group"));
await sync(addChatMember(groupChatId, callerId));

async function writeCallLog(chatId, userId, body) {
  return sync(
    createMessage(chatId, userId, body, null, null, null, {
      allowPlaintextSystemMessage: true,
    }),
  );
}

// Seed: a connected group call, a missed DM voice call, a declined video DM
// call, plus one regular message that must never appear as a call.
await sync(writeCallLog(groupChatId, callerId, "[[call:audio:connected:125]]"));
await sync(writeCallLog(dmChatId, callerId, "[[call:audio:missed]]"));
await sync(writeCallLog(dmChatId, calleeId, "[[call:video:declined:0]]"));
await sync(
  createMessage(dmChatId, callerId, "[[call:audio:connected:999]]"),
);

describe("adminListCalls (call-history report)", () => {
  test("lists every call log with caller, chat and parsed fields", async () => {
    const page = await sync(adminListCalls({}));
    expect(page.total).toBe(3);
    expect(page.calls).toHaveLength(3);

    const byBody = Object.fromEntries(page.calls.map((c) => [c.body, c]));
    const group = byBody["[[call:audio:connected:125]]"];
    expect(group).toBeTruthy();
    expect(group.type).toBe("audio");
    expect(group.status).toBe("connected");
    expect(group.durationSeconds).toBe(125);
    expect(group.caller_username).toBe("acall-caller");
    expect(group.chat_name).toBe("Support Team");
    expect(group.chat_type).toBe("group");

    const missed = byBody["[[call:audio:missed]]"];
    expect(missed).toBeTruthy();
    expect(missed.durationSeconds).toBeNull();
    expect(missed.chat_type).toBe("dm");
    expect(String(missed.participants)).toContain("acall-caller");
    expect(String(missed.participants)).toContain("acall-callee");
  });

  test("user-typed call-body look-alikes never appear", async () => {
    const page = await sync(adminListCalls({}));
    for (const call of page.calls) {
      expect(call.body).not.toContain("connected:999");
    }
    expect(page.total).toBe(3);
  });

  test("type filter narrows to audio or video", async () => {
    const audio = await sync(adminListCalls({ typeFilter: "audio" }));
    expect(audio.total).toBe(2);
    expect(audio.calls.every((c) => c.type === "audio")).toBe(true);

    const video = await sync(adminListCalls({ typeFilter: "video" }));
    expect(video.total).toBe(1);
    expect(video.calls[0]).toMatchObject({ type: "video", status: "declined" });
  });

  test("status filter matches 3- and 4-segment bodies", async () => {
    const missed = await sync(adminListCalls({ statusFilter: "missed" }));
    expect(missed.total).toBe(1);
    expect(missed.calls[0].body).toBe("[[call:audio:missed]]");

    const connected = await sync(adminListCalls({ statusFilter: "connected" }));
    expect(connected.total).toBe(1);
    expect(connected.calls[0].body).toBe("[[call:audio:connected:125]]");

    const declined = await sync(adminListCalls({ statusFilter: "declined" }));
    expect(declined.total).toBe(1);
  });

  test("chat filter narrows to one conversation", async () => {
    const dmCalls = await sync(adminListCalls({ chatFilter: dmChatId }));
    expect(dmCalls.total).toBe(2);
    expect(dmCalls.calls.every((c) => c.chat_id === dmChatId)).toBe(true);
  });

  test("search matches caller username and DM participants", async () => {
    // Search spans caller username, nickname, chat name AND every chat
    // member (DM chats have no name of their own), so searching a username
    // finds calls that user participated in, not only calls they dialled.
    const byCaller = await sync(adminListCalls({ search: "acall-caller" }));
    expect(byCaller.total).toBe(3);

    const byParticipant = await sync(adminListCalls({ search: "acall-callee" }));
    expect(byParticipant.total).toBe(2);
  });

  test("pagination respects limit and offset", async () => {
    const firstPage = await sync(adminListCalls({ limit: 2, offset: 0, sortBy: "id", sortDir: "ASC" }));
    expect(firstPage.calls).toHaveLength(2);
    expect(firstPage.total).toBe(3);

    const secondPage = await sync(adminListCalls({ limit: 2, offset: 2, sortBy: "id", sortDir: "ASC" }));
    expect(secondPage.calls).toHaveLength(1);
    const ids = new Set([...firstPage.calls, ...secondPage.calls].map((c) => c.id));
    expect(ids.size).toBe(3);
  });
});
