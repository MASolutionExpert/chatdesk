import { describe, expect, test, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Per-thread message search db layer — searchChatMessagesForUser /
// countChatMessageSearchForUser.
//
// Guarantees under test (SQLite driver):
//   * matches message text from BOTH sides, newest first, with sender identity
//   * matches are case-insensitive (mirrors the PostgreSQL lower() path)
//   * single characters and numbers are valid search terms
//   * attachment file names match too (message with empty body still found)
//   * LIKE wildcards (% _) are matched LITERALLY, not as patterns
//   * system messages ([[system:...]]) never match
//   * hidden-for-everyone and viewer-hidden messages never match for the
//     viewer, viewer-hidden still match for the sender
//   * offset/limit pagination + count agree
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; this suite is SQLite-only.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-chatsearch-"));

const {
  createUser,
  createChat,
  addChatMember,
  createMessage,
  createMessageFiles,
  hideMessageForEveryone,
  hideMessageForUser,
  searchChatMessagesForUser,
  countChatMessageSearchForUser,
} = await import("../../db.js");

const sync = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

const FILE = (name, mime = "application/pdf") => ({
  kind: mime.startsWith("image/") ? "image" : "document",
  originalName: name,
  storedName: `${name}.stored`,
  mimeType: mime,
  sizeBytes: 1234,
});

describe("per-thread message search (db layer)", () => {
  const aliceId = createUser("search-alice", "hash", "Alice", null, null, {
    role: "user",
  });
  const bobId = createUser("search-bob", "hash", "Bob", null, null, {
    role: "user",
  });

  let chatId;
  beforeAll(async () => {
    chatId = await sync(createChat(null, "dm"));
    await sync(addChatMember(chatId, aliceId, "owner"));
    await sync(addChatMember(chatId, bobId, "member"));
  });

  test("matches text from both sides, newest first, with sender identity", async () => {
    await sync(createMessage(chatId, aliceId, "please check invoice #42"));
    // created_at has second precision — wait past the second boundary so the
    // "newest first" ordering assertion is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await sync(createMessage(chatId, bobId, "Invoice received, thanks!"));

    const { rows, total } = await sync(searchChatMessagesForUser(chatId, aliceId, "invoice"));
    expect(rows).toHaveLength(2);
    // newest first → Bob's later message first
    expect(rows[0].username).toBe("search-bob");
    expect(rows[0].nickname).toBe("Bob");
    expect(rows[0].body).toContain("Invoice received");
    expect(rows[0].created_at).toBeTruthy();
    expect(rows[1].username).toBe("search-alice");

    expect(total).toBe(2);
  });

  test("matching is case-insensitive on the stored text", async () => {
    await sync(createMessage(chatId, bobId, "The SERVER is Up"));
    const { rows } = await sync(searchChatMessagesForUser(chatId, aliceId, "server is up"));
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("The SERVER is Up");
  });

  test("single characters and numbers are valid terms", async () => {
    await sync(createMessage(chatId, bobId, "room 7 is ready"));
    const { rows: byChar } = await sync(searchChatMessagesForUser(chatId, aliceId, "7"));
    expect(byChar.map((r) => r.body)).toContain("room 7 is ready");
    const { rows: byNum } = await sync(searchChatMessagesForUser(chatId, aliceId, "42"));
    expect(byChar.map((r) => r.body)).toContain("room 7 is ready");
    expect(byNum.length).toBeGreaterThanOrEqual(1);
  });

  test("attachment file names match even when the body is empty", async () => {
    const msgId = await sync(createMessage(chatId, bobId, ""));
    await sync(createMessageFiles(msgId, [FILE("contract-2026.pdf")]));

    const { rows, total } = await sync(searchChatMessagesForUser(chatId, aliceId, "contract-2026"));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(msgId);
    expect(total).toBe(1);
  });

  test("LIKE wildcards in the term are matched literally", async () => {
    await sync(createMessage(chatId, bobId, "discount 50%_off today"));
    // Literal "%" should match ONLY the message containing a real "%"
    const { rows } = await sync(searchChatMessagesForUser(chatId, aliceId, "%_off"));
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain("50%_off");
  });

  test("system messages never match", async () => {
    // Real system messages are created with allowPlaintextSystemMessage: true
    // (plaintext [[system:...]] bodies that END with "]]") — the SQL
    // pre-filter excludes them, even when the term appears inside the marker.
    await sync(
      createMessage(chatId, bobId, "[[system:joined:invoice fan]]", null, null, null, {
        allowPlaintextSystemMessage: true,
      }),
    );
    const { rows } = await sync(searchChatMessagesForUser(chatId, aliceId, "invoice"));
    expect(rows.map((r) => r.body)).not.toContain("[[system:joined:invoice fan]]");
  });

  test("hidden-for-everyone messages never match", async () => {
    const msgId = await sync(createMessage(chatId, bobId, "zzx-secret-deleted"));
    await sync(hideMessageForEveryone(msgId));
    const { rows, total } = await sync(searchChatMessagesForUser(chatId, aliceId, "zzx-secret-deleted"));
    expect(rows).toHaveLength(0);
    expect(total).toBe(0);
  });

  test("viewer-hidden messages are excluded only for that viewer", async () => {
    const msgId = await sync(createMessage(chatId, bobId, "zzx-hidden-for-alice"));
    await sync(hideMessageForUser(msgId, aliceId));

    const aliceSearch = await sync(searchChatMessagesForUser(chatId, aliceId, "zzx-hidden-for-alice"));
    expect(aliceSearch.rows).toHaveLength(0);

    // Bob (the sender) still finds his own message
    const bobSearch = await sync(searchChatMessagesForUser(chatId, bobId, "zzx-hidden-for-alice"));
    expect(bobSearch.rows).toHaveLength(1);
  });

  test("offset/limit pagination agrees with the count", async () => {
    for (let i = 1; i <= 5; i++) {
      await sync(createMessage(chatId, bobId, `zzx-page message ${i}`));
    }
    const totalSearch = await sync(searchChatMessagesForUser(chatId, aliceId, "zzx-page"));
    expect(totalSearch.total).toBe(5);

    const page1 = await sync(searchChatMessagesForUser(chatId, aliceId, "zzx-page", { limit: 2, offset: 0 }));
    const page2 = await sync(searchChatMessagesForUser(chatId, aliceId, "zzx-page", { limit: 2, offset: 2 }));
    const page3 = await sync(searchChatMessagesForUser(chatId, aliceId, "zzx-page", { limit: 2, offset: 4 }));
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    expect(page3.rows).toHaveLength(1);
    const ids = [...page1.rows, ...page2.rows, ...page3.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(5);
  });

  test("empty / @-only terms match nothing", async () => {
    expect((await sync(searchChatMessagesForUser(chatId, aliceId, ""))).rows).toHaveLength(0);
    expect((await sync(searchChatMessagesForUser(chatId, aliceId, "@"))).rows).toHaveLength(0);
    expect((await sync(searchChatMessagesForUser(chatId, aliceId, "   "))).rows).toHaveLength(0);
    expect((await sync(searchChatMessagesForUser(chatId, aliceId, ""))).total).toBe(0);
  });

  test("another chat's messages never leak into this thread's results", async () => {
    const otherChatId = await sync(createChat(null, "dm"));
    await sync(addChatMember(otherChatId, aliceId, "owner"));
    await sync(addChatMember(otherChatId, bobId, "member"));
    await sync(createMessage(otherChatId, bobId, "zzx-page private other thread"));

    const { rows } = await sync(searchChatMessagesForUser(chatId, aliceId, "zzx-page"));
    expect(rows.map((r) => r.body)).not.toContain("zzx-page private other thread");
  });
});
