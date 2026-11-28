import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 MEDIUM (F4): chats used to be deleted WITHOUT their tickets.
// tickets rides 1:1 on the support chat (tickets.chat_id UNIQUE), so ghost
// tickets survived deleteChatById / deleteUserById and kept being counted by
// getSupportReport and pickOperatorForDepartment; adminResetDatabase's
// TRUNCATE/table-wipe list also omitted tickets. Additionally, the per-user
// chat purge in deleteUserById left hidden_chat_messages rows written by
// OTHER users pointing at the deleted chat's messages.
//
// Pinned contract:
//   - deleteChatById removes the chat's ticket;
//   - deleteUserById removes tickets + other users' hidden marks for each
//     purged chat;
//   - adminResetDatabase wipes tickets along with chats.
// ─────────────────────────────────────────────────────────────────────────────

process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-chat-tickets-"));

const {
  createUser,
  createChat,
  addChatMember,
  createDepartment,
  markChatDepartment,
  createMessage,
  createTicketRow,
  getTicketByChatId,
  hideMessageForUser,
  deleteChatById,
  deleteUserById,
  adminResetDatabase,
  getAll,
} = await import("../../db.js");

const open = (v) => (v && typeof v.then === "function" ? Promise.resolve(v) : v);

let seq = 0;

async function buildSupportChat({ withOperatorMember = true } = {}) {
  seq += 1;
  const opId = createUser(`tickets-op-${seq}`, "hash", "Op", null, null, { role: "operator" });
  const custId = createUser(`tickets-cust-${seq}`, "hash", "Cust", null, null, { role: "user" });
  const dept = await open(createDepartment({ name: `Dept ${seq}` }));
  const chatId = await open(createChat(null, "dm", { channel: "support" }));
  await open(addChatMember(chatId, custId, "owner"));
  if (withOperatorMember) {
    await open(addChatMember(chatId, opId, "member"));
  }
  await open(markChatDepartment(chatId, dept.id));
  await open(createMessage(chatId, custId, "help please"));
  await open(
    createTicketRow({ chatId, departmentId: dept.id, customerId: custId, operatorId: opId }),
  );
  return { opId, custId, chatId };
}

describe("chat deletion removes its ticket (no ghosts)", () => {
  test("deleteChatById deletes the ticket with the chat", async () => {
    const { chatId } = await buildSupportChat();
    expect(await open(getTicketByChatId(chatId))).not.toBeNull();

    await open(deleteChatById(chatId));

    expect(await open(getTicketByChatId(chatId))).toBeNull();
    expect(getAll("SELECT COUNT(*) AS n FROM tickets")[0].n).toBe(0);
  });

  test("deleteUserById purges tickets + other users' hidden marks for deleted chats", async () => {
    // Sole-member chat: deleting the customer must delete the whole chat
    // (no remaining member to transfer ownership to).
    const { opId, custId, chatId } = await buildSupportChat({ withOperatorMember: false });
    const messageId = getAll(
      "SELECT id FROM chat_messages WHERE chat_id = ?",
      [chatId],
    )[0].id;

    // The OPERATOR hides the customer's message — this mark must not survive
    // the customer's deletion (the message is gone with the chat).
    await open(hideMessageForUser(messageId, opId));
    expect(
      getAll("SELECT COUNT(*) AS n FROM hidden_chat_messages")[0].n,
    ).toBe(1);

    const result = await open(deleteUserById(custId));

    // The customer owned the chat alone with the operator → chat purged.
    expect(result.deletedChatIds).toContain(chatId);
    expect(await open(getTicketByChatId(chatId))).toBeNull();
    expect(
      getAll(
        "SELECT COUNT(*) AS n FROM hidden_chat_messages WHERE message_id = ?",
        [messageId],
      )[0].n,
    ).toBe(0);
    expect(getAll("SELECT COUNT(*) AS n FROM tickets")[0].n).toBe(0);
  });

  test("adminResetDatabase wipes tickets alongside chats", async () => {
    await buildSupportChat();
    const before = Number(getAll("SELECT COUNT(*) AS n FROM tickets")[0].n);
    expect(before).toBeGreaterThan(0);

    await open(adminResetDatabase());

    expect(getAll("SELECT COUNT(*) AS n FROM tickets")[0].n).toBe(0);
    expect(getAll("SELECT COUNT(*) AS n FROM chats")[0].n).toBe(0);
  });
});
