import { describe, test, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chats/:chatId/search — per-thread message search (profile "Search").
//
// Guarantees under test:
//   * members get matching messages from BOTH sides, newest first, each row
//     carrying the sender identity and the original message timestamp (sentAt)
//   * non-members are rejected with 403
//   * missing username → 400, unknown user → 404
//   * missing / @-only / blank search term → 400
//   * pagination fields (total / hasMore) are echoed correctly
// ─────────────────────────────────────────────────────────────────────────────

async function loginCookie(app, username = "alice", password = "secret123") {
  const res = await request(app)
    .post("/api/login")
    .send({ username, password });
  return res.headers["set-cookie"];
}

describe("per-thread message search API", () => {
  const chatId = "55555555-5555-4555-8555-555555555555";
  const otherChatId = "66666666-6666-4666-8666-666666666666";

  function createTestApp({ results = [], total } = {}) {
    const userStore = makeUserStore([
      {
        id: "11111111-1111-4111-a111-111111111111",
        username: "alice",
        password_hash: bcrypt.hashSync("secret123", 4),
        nickname: "Alice",
        avatar_url: null,
        color: "#10b981",
        status: "online",
        role: "user",
        banned: false,
      },
      {
        id: "22222222-2222-4222-b222-222222222222",
        username: "bob",
        password_hash: bcrypt.hashSync("secret123", 4),
        nickname: "Bob",
        avatar_url: null,
        color: "#10b981",
        status: "online",
        role: "user",
        banned: false,
      },
    ]);

    const rows = results.map((r, i) => ({
      id: r.id ?? `msg-${i + 1}`,
      body: r.body ?? "invoice 42",
      created_at: r.created_at ?? "2026-01-01T12:30:00.000Z",
      user_id: r.user_id ?? "22222222-2222-4222-b222-222222222222",
      username: r.username ?? "bob",
      nickname: r.nickname ?? "Bob",
      color: r.color ?? "#10b981",
      avatar_url: r.avatar_url ?? null,
    }));

    const { app } = makeApp({
      userStore,
      deps: {
        isMember: (cId, _uId) => cId === chatId,
        searchChatMessagesForUser: (cId, _uId, term, options = {}) => {
          const offset = Number(options.offset || 0);
          const limit = Number(options.limit || 50);
          return {
            rows: rows.slice(offset, offset + limit),
            total: Number(total ?? rows.length),
            scannedAll: true,
          };
        },
      },
    });

    return { app, rows };
  }

  test("returns matching messages with sender identity and sentAt timestamp", async () => {
    const { app } = createTestApp({
      results: [
        { body: "Invoice received", created_at: "2026-02-06T09:10:00.000Z" },
        { body: "please check invoice #42", username: "alice", created_at: "2026-02-05T18:45:00.000Z" },
      ],
      total: 2,
    });
    const cookie = await loginCookie(app);

    const res = await request(app)
      .get(`/api/chats/${chatId}/search?username=alice&q=invoice`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.query).toBe("invoice");
    expect(res.body.results).toHaveLength(2);

    const [first, second] = res.body.results;
    expect(first.messageId).toBeTruthy();
    expect(first.body).toBe("Invoice received");
    expect(first.sender.username).toBe("bob");
    expect(first.sender.nickname).toBe("Bob");
    expect(first.sentAt).toBe("2026-02-06T09:10:00.000Z");
    expect(second.sender.username).toBe("alice");
  });

  test("paginates with offset and reports hasMore", async () => {
    const { app } = createTestApp({
      results: Array.from({ length: 5 }, (_, i) => ({ body: `hit ${i}` })),
      total: 5,
    });
    const cookie = await loginCookie(app);

    const page1 = await request(app)
      .get(`/api/chats/${chatId}/search?username=alice&q=hit&limit=3&offset=0`)
      .set("Cookie", cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.results).toHaveLength(3);
    expect(page1.body.hasMore).toBe(true);

    const page2 = await request(app)
      .get(`/api/chats/${chatId}/search?username=alice&q=hit&limit=3&offset=3`)
      .set("Cookie", cookie);
    expect(page2.status).toBe(200);
    expect(page2.body.results).toHaveLength(2);
    expect(page2.body.hasMore).toBe(false);
  });

  test("rejects non-members with 403", async () => {
    const { app } = createTestApp();
    const cookie = await loginCookie(app);

    const res = await request(app)
      .get(`/api/chats/${otherChatId}/search?username=alice&q=invoice`)
      .set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
  });

  test("rejects missing username with 400", async () => {
    const { app } = createTestApp();
    const cookie = await loginCookie(app);

    const res = await request(app)
      .get(`/api/chats/${chatId}/search?q=invoice`)
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
  });

  test("rejects missing, blank and @-only search terms with 400", async () => {
    const { app } = createTestApp();
    const cookie = await loginCookie(app);

    const missing = await request(app)
      .get(`/api/chats/${chatId}/search?username=alice`)
      .set("Cookie", cookie);
    expect(missing.status).toBe(400);

    const blank = await request(app)
      .get(`/api/chats/${chatId}/search?username=alice&q=${encodeURIComponent("   ")}`)
      .set("Cookie", cookie);
    expect(blank.status).toBe(400);

    const atOnly = await request(app)
      .get(`/api/chats/${chatId}/search?username=alice&q=@`)
      .set("Cookie", cookie);
    expect(atOnly.status).toBe(400);
  });

  test("requesting as another username is rejected with 403 (session mismatch)", async () => {
    const { app } = createTestApp();
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .get(`/api/chats/${chatId}/search?username=nobody&q=invoice`)
      .set("Cookie", cookie);

    expect(res.status).toBe(403);
  });
});
