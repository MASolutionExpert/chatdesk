import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 MEDIUM (F6): getSupportReport loaded the FULL message history of
// every support chat with a single unbounded
// `whereIn(chat_id, <all ids>)` — past the SQLite/PG bind-parameter limits
// (999 / 65535) the query fails outright, and the row payload itself caused
// slow/OOM aggregation on large installs. It also loaded the ENTIRE users
// table although the aggregator only classifies authors by STAFF roles
// (STAFF_ROLES = {operator, owner} in lib/supportReport.js).
//
// Fixed contract pinned here:
//   - the chat-id IN list is chunked (SUPPORT_REPORT_IN_CHUNK = 500): more
//     than 500 involved chats still produce the exact same numbers;
//   - role rows are restricted to SUPPORT_ROLES (output unchanged: non-staff
//     authors classify as customers either way).
// ─────────────────────────────────────────────────────────────────────────────

process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-support-chunk-"));

const {
  createUser,
  createChat,
  addChatMember,
  createDepartment,
  markChatDepartment,
  setUserDepartment,
  createMessage,
  createTicketRow,
  getSupportReport,
  getAll,
} = await import("../../db.js");

const open = (v) => (v && typeof v.then === "function" ? Promise.resolve(v) : v);

describe("getSupportReport — bounded scans, unchanged numbers", () => {
  test("a department with > 500 support chats reports correctly (chunked IN lists)", async () => {
    const dept = await open(createDepartment({ name: "Mega" }));
    const opId = createUser("chunk-op", "hash", "Op", null, null, { role: "operator" });
    const custId = createUser("chunk-cust", "hash", "Cust", null, null, { role: "user" });
    await open(setUserDepartment(opId, dept.id));

    const CHAT_COUNT = 600; // > SUPPORT_REPORT_IN_CHUNK (500)
    const createdIds = [];
    for (let i = 0; i < CHAT_COUNT; i += 1) {
      const chatId = await open(createChat(null, "dm", { channel: "support" }));
      await open(addChatMember(chatId, custId, "owner"));
      await open(addChatMember(chatId, opId, "member"));
      await open(markChatDepartment(chatId, dept.id));
      await open(createMessage(chatId, custId, `chunk message ${i}`));
      createdIds.push(chatId);
    }
    // One ticket for a third of the chats (all open).
    const TICKET_COUNT = Math.ceil(CHAT_COUNT / 3);
    for (let i = 0; i < CHAT_COUNT; i += 3) {
      await open(
        createTicketRow({
          chatId: createdIds[i],
          departmentId: dept.id,
          customerId: custId,
          operatorId: opId,
        }),
      );
    }

    const report = await open(getSupportReport({ departmentId: dept.id }));
    expect(Array.isArray(report.departments)).toBe(true);
    expect(report.departments).toHaveLength(1);

    const card = report.departments[0];
    expect(card.id).toBe(Number(dept.id));

    // Every chat and message is accounted for — nothing lost to chunking.
    expect(card.totals.conversations).toBe(CHAT_COUNT);
    expect(card.totals.messages).toBe(CHAT_COUNT);
    expect(card.totals.customerMessages).toBe(CHAT_COUNT);
    expect(card.totals.openTickets).toBe(TICKET_COUNT);
    expect(card.operatorCount).toBe(1);
  });

  test("non-staff authors still classify as customers after the roleRows restriction", async () => {
    const dept = await open(createDepartment({ name: "Roles" }));
    const opId = createUser("roles-op", "hash", "Op", null, null, { role: "operator" });
    const custId = createUser("roles-cust", "hash", "Cust", null, null, { role: "user" });
    await open(setUserDepartment(opId, dept.id));
    const chatId = await open(createChat(null, "dm", { channel: "support" }));
    await open(addChatMember(chatId, custId, "owner"));
    await open(addChatMember(chatId, opId, "member"));
    await open(markChatDepartment(chatId, dept.id));
    await open(createTicketRow({ chatId, departmentId: dept.id, customerId: custId, operatorId: opId }));
    // Customer writes, operator replies.
    await open(createMessage(chatId, custId, "customer first"));
    await open(createMessage(chatId, opId, "operator reply"));

    const report = await open(getSupportReport({ departmentId: dept.id }));
    const card = report.departments[0];
    expect(card.totals.messages).toBe(2);
    // Author → role classification still works with the restricted roleRows:
    // the customer's message counts as a customer message, the operator's as
    // staff — proving the role map covered both despite loading only staff.
    expect(card.totals.customerMessages).toBe(1);
    expect(card.totals.staffMessages).toBe(1);
    // And the ticket rows are still found (tickets loaded separately).
    expect(card.totals.openTickets).toBe(1);
    // Sanity: the fixtures really exist in the db.
    expect(Number(getAll("SELECT COUNT(*) AS n FROM tickets")[0].n)).toBeGreaterThan(0);
  });
});
