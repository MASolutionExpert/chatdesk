import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 LOW (F9): listChatsForUser ordered by `last_vm.created_at DESC`.
// SQLite sorts NULLs LAST on DESC, but PostgreSQL sorts them FIRST — so on PG
// chats without any message ("empty" chats) floated to the TOP of the chat
// list. Fixed with the portable idiom used elsewhere in the codebase (see
// buildStaffReferCandidatesQuery): an `expr IS NULL ASC` ordering key first.
//
// This test pins the SQLite behavior (unchanged by the fix); the PG side
// (NULLS FIRST) is dialect behavior and is asserted by the generated-SQL
// parity via the same expression — PG-only residual noted in the report.
// ─────────────────────────────────────────────────────────────────────────────

process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-chats-nulls-"));

const { createUser, createChat, addChatMember, createMessage, listChatsForUser, run, getRow } =
  await import("../../db.js");

const open = (v) => (v && typeof v.then === "function" ? Promise.resolve(v) : v);

describe("listChatsForUser — chats with messages first, empty chats last", () => {
  test("empty chats sort after chats with a last message", async () => {
    const userId = createUser("nulls-user", "hash", "U", null, null);
    const otherId = createUser("nulls-other", "hash", "O", null, null);

    const chatWithMessage = await open(createChat(null, "dm"));
    await open(addChatMember(chatWithMessage, userId, "owner"));
    await open(addChatMember(chatWithMessage, otherId, "member"));

    // Give the WITH-message chat an older timestamp so ordering is not
    // accidentally satisfied by insertion order/recency.
    const emptyChat = await open(createChat(null, "dm"));
    await open(addChatMember(emptyChat, userId, "owner"));
    await open(addChatMember(emptyChat, otherId, "member"));

    await open(
      createMessage(chatWithMessage, otherId, "older message", {
        createdAt: "2024-01-01T00:00:00.000Z",
      }),
    );

    const rows = await open(listChatsForUser(userId));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(chatWithMessage);
    expect(ids).toContain(emptyChat);

    // The chat WITH a (older) last message must come before the empty one.
    expect(ids.indexOf(chatWithMessage)).toBeLessThan(ids.indexOf(emptyChat));

    // Empty chat exposes a null last message.
    const emptyRow = rows.find((r) => r.id === emptyChat);
    expect(emptyRow.last_message_id).toBeNull();
  });
});
