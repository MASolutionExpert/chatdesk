import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 MEDIUM (F3): several db.js write-path wrappers dropped run()'s
// result. On SQLite run() is synchronous so nothing observable broke, but on
// Postgres run() returns a PROMISE: dropping it meant (a) callers could not
// await the write (e.g. setChatMemberRole raced with the following read) and
// (b) a rejected query became an UNHANDLED REJECTION — with no handler in
// server/index.js, that crashes the process.
//
// Pinned contract (SQLite side): every fixed wrapper now returns run()'s
// result, so the caller receives the affected-row count and — on PG — a real
// promise to await. (The PG promise-propagation itself is a dialect behavior
// and cannot be integration-tested without a live Postgres; see report.)
// ─────────────────────────────────────────────────────────────────────────────

process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-write-returns-"));

const {
  createUser,
  createChat,
  addChatMember,
  setChatMemberRole,
  releaseStaleRemoteChannelQueueItems,
  run,
  dbSetSetting,
  dbDeleteSetting,
  dbGetSetting,
  setMessageExpiresAt,
  editMessage,
  hideMessageForUser,
  hideMessageForEveryone,
  getAll,
  getRow,
} = await import("../../db.js");

const open = (v) => (v && typeof v.then === "function" ? Promise.resolve(v) : v);

describe("write-path wrappers return run()'s result (F3)", () => {
  test("setChatMemberRole returns the affected-row count and persists", async () => {
    const userId = createUser("wr-user", "hash", "U", null, null);
    const chatId = await open(createChat(null, "dm"));
    await open(addChatMember(chatId, userId, "member"));

    const changed = await open(setChatMemberRole(chatId, userId, "operator"));
    expect(Number(changed)).toBe(1);

    const role = getRow(
      "SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?",
      [chatId, userId],
    );
    expect(role.role).toBe("operator");
  });

  test("releaseStaleRemoteChannelQueueItems returns the affected-row count and releases stale items", async () => {
    const userId = createUser("wr-q-user", "hash", "U", null, null);
    const chatId = await open(createChat(null, "dm"));
    await open(addChatMember(chatId, userId, "member"));
    // A real source row (remote_channel_queue.source_id has an FK to it).
    run(
      `INSERT INTO remote_channel_sources (chat_id, provider, enabled) VALUES (?, 'telegram', 1)`,
      [chatId],
    );
    const sourceId = getRow("SELECT id FROM remote_channel_sources WHERE chat_id = ?", [chatId]).id;
    // Seed a stale 'processing' queue item (locked_at far in the past).
    run(
      `INSERT INTO remote_channel_queue
         (source_id, provider, telegram_update_id, payload_json, status, attempts,
          next_attempt_at, locked_at, lock_owner, created_at)
       VALUES (?, 'telegram', 1, '{}', 'processing', 0, '2020-01-01T00:00:00.000Z',
               '2020-01-01T00:00:00.000Z', 'worker-1', '2020-01-01T00:00:00.000Z')`,
      [sourceId],
    );

    const changed = await open(releaseStaleRemoteChannelQueueItems(new Date().toISOString()));
    expect(Number(changed)).toBe(1);

    const item = getRow(
      "SELECT status, locked_at, lock_owner FROM remote_channel_queue WHERE telegram_update_id = 1",
    );
    expect(item.status).toBe("retry");
    expect(item.locked_at).toBeNull();
    expect(item.lock_owner).toBeNull();

    // Non-stale items are untouched.
    run(
      `INSERT INTO remote_channel_queue
         (source_id, provider, telegram_update_id, payload_json, status, attempts,
          next_attempt_at, locked_at, lock_owner, created_at)
       VALUES (?, 'telegram', 2, '{}', 'processing', 0, '2999-01-01T00:00:00.000Z',
               '2999-01-01T00:00:00.000Z', 'worker-1', '2999-01-01T00:00:00.000Z')`,
      [sourceId],
    );
    const changed2 = await open(releaseStaleRemoteChannelQueueItems(new Date().toISOString()));
    expect(Number(changed2)).toBe(0);
    const fresh = getRow("SELECT status FROM remote_channel_queue WHERE telegram_update_id = 2");
    expect(fresh.status).toBe("processing");
  });

  test("message mutation wrappers return the affected-row count", async () => {
    const userId = createUser("wr-msg-user", "hash", "U", null, null);
    const chatId = await open(createChat(null, "dm"));
    await open(addChatMember(chatId, userId, "owner"));
    const createRes = await open(
      run(
        "INSERT INTO chat_messages (id, chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
        [randomUUID(), chatId, userId, "hello"],
      ),
    );
    expect(Number(createRes)).toBe(1);
    const messageId = getRow("SELECT id FROM chat_messages WHERE chat_id = ?", [chatId]).id;

    expect(Number(await open(setMessageExpiresAt(messageId, null)))).toBe(1);
    expect(Number(await open(editMessage(messageId, "edited body")))).toBe(1);
    expect(Number(await open(hideMessageForEveryone(messageId)))).toBe(1);
    // hideMessageForUser: first insert = 1 change (upsert merge counts 1).
    expect(Number(await open(hideMessageForUser(messageId, userId)))).toBe(1);
    // editMessage writes the edited copy into edited_body (encrypted at rest);
    // assert the edit flag instead of the encrypted payload.
    expect(getRow("SELECT edited FROM chat_messages WHERE id = ?", [messageId]).edited).toBe(1);
    expect(
      getRow("SELECT hidden_everyone_at FROM chat_messages WHERE id = ?", [messageId])
        .hidden_everyone_at,
    ).not.toBeNull();
    expect(
      getRow("SELECT COUNT(*) AS n FROM hidden_chat_messages WHERE message_id = ?", [messageId])
        .n,
    ).toBe(1);
  });

  test("app_settings wrappers return run()'s result", async () => {
    const setRes = await open(dbSetSetting("wr-key", "wr-value"));
    expect(Number(setRes)).toBe(1);
    expect(await open(dbGetSetting("wr-key"))).toBe("wr-value");
    const delRes = await open(dbDeleteSetting("wr-key"));
    expect(Number(delRes)).toBe(1);
    expect(await open(dbGetSetting("wr-key"))).toBeNull();
  });
});
