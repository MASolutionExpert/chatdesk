import { describe, expect, test, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Chat files gallery db layer — listChatFilesForUser / countChatFilesForUser.
//
// Guarantees under test (SQLite driver):
//   * every file sent in the thread by ANY member is listed (both sides),
//     newest first, with sender identity + original message timestamp
//   * messages hidden for everyone never leak their files
//   * messages hidden for the VIEWER leak nothing to that viewer, but still
//     show for the other participant
//   * offset/limit pagination matches countChatFilesForUser
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; this suite is SQLite-only.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-chatfiles-"));

const {
  createUser,
  createChat,
  addChatMember,
  createMessage,
  createMessageFiles,
  hideMessageForEveryone,
  hideMessageForUser,
  listChatFilesForUser,
  countChatFilesForUser,
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

describe("chat files gallery (db layer)", () => {
  const aliceId = createUser("files-alice", "hash", "Alice", null, null, {
    role: "user",
  });
  const bobId = createUser("files-bob", "hash", "Bob", null, null, {
    role: "user",
  });

  let chatId;
  beforeAll(async () => {
    chatId = await sync(createChat(null, "dm"));
    await sync(addChatMember(chatId, aliceId, "owner"));
    await sync(addChatMember(chatId, bobId, "member"));
  });

  test("lists files from both sides newest-first with sender + timestamp", async () => {
    const older = await sync(createMessage(chatId, aliceId, "old doc"));
    await sync(createMessageFiles(older, [FILE("old.pdf")]));

    const newer = await sync(createMessage(chatId, bobId, "new photo"));
    await sync(createMessageFiles(newer, [FILE("new.png", "image/png")]));

    const files = await sync(listChatFilesForUser(chatId, aliceId));
    expect(files).toHaveLength(2);

    // newest first (Bob's later message first)
    expect(files[0].original_name).toBe("new.png");
    expect(files[0].username).toBe("files-bob");
    expect(files[0].nickname).toBe("Bob");
    expect(files[0].sender_user_id).toBe(bobId);
    expect(files[0].message_created_at).toBeTruthy();

    expect(files[1].original_name).toBe("old.pdf");
    expect(files[1].username).toBe("files-alice");

    const total = await sync(countChatFilesForUser(chatId, aliceId));
    expect(total).toBe(2);
  });

  test("hidden-for-everyone messages leak no files", async () => {
    const msgId = await sync(createMessage(chatId, bobId, "deleted photo"));
    await sync(createMessageFiles(msgId, [FILE("gone.png", "image/png")]));
    await sync(hideMessageForEveryone(msgId));

    const aliceFiles = await sync(listChatFilesForUser(chatId, aliceId));
    expect(aliceFiles.map((f) => f.original_name)).not.toContain("gone.png");
    const aliceTotal = await sync(countChatFilesForUser(chatId, aliceId));
    expect(aliceTotal).toBe(2);
  });

  test("viewer-hidden messages are excluded only for that viewer", async () => {
    const msgId = await sync(createMessage(chatId, bobId, "hidden for alice"));
    await sync(createMessageFiles(msgId, [FILE("private.pdf")]));

    await sync(hideMessageForUser(msgId, aliceId));

    const aliceFiles = await sync(listChatFilesForUser(chatId, aliceId));
    expect(aliceFiles.map((f) => f.original_name)).not.toContain("private.pdf");
    expect(await sync(countChatFilesForUser(chatId, aliceId))).toBe(2);

    // Bob (the sender) still sees the file
    const bobFiles = await sync(listChatFilesForUser(chatId, bobId));
    expect(bobFiles.map((f) => f.original_name)).toContain("private.pdf");
    expect(await sync(countChatFilesForUser(chatId, bobId))).toBe(3);
  });

  test("offset/limit pagination is stable", async () => {
    const page1 = await sync(listChatFilesForUser(chatId, bobId, { limit: 1, offset: 0 }));
    const page2 = await sync(listChatFilesForUser(chatId, bobId, { limit: 10, offset: 1 }));
    expect(page1).toHaveLength(1);
    expect(page2.length).toBeGreaterThan(0);
    expect(page2.map((f) => f.id)).not.toContain(page1[0].id);

    const all = await sync(listChatFilesForUser(chatId, bobId));
    expect([...page1, ...page2].map((f) => f.id).sort()).toEqual(
      all.map((f) => f.id).sort(),
    );
  });
});
