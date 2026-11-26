import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Operator-first ticket identity — REAL database integration (SQLite).
//
// 1.7.0-dev.8 philosophy: chats/tickets/calls belong to the USER (the
// customer↔operator pair); the department is only the routing entry that
// groups operators. Deleting a department must therefore:
//   1. leave the ticket fully alive (thread, messages, ticket row);
//   2. re-attribute its report/overview stats to the operator's CURRENT
//      department;
//   3. never erase history — tickets of detached operators land in the
//      removed-departments bucket (id: null) instead of vanishing.
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; this suite is SQLite-only.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-op-first-"));

const {
  createUser,
  createChat,
  addChatMember,
  createDepartment,
  setUserDepartment,
  markChatDepartment,
  createTicketRow,
  createMessage,
  getTicketByChatId,
  setTicketDepartmentByChatId,
  setTicketStatusByChatId,
  getSupportReport,
  getSupportOverview,
  hardDeleteDepartment,
  listDepartments,
} = await import("../../db.js");

const open = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

describe("operator-first ticket identity after department deletion", () => {
  let deptA, deptB, opId, custId, chatId;

  test("deleted department: ticket stays alive, stats follow the operator's new department", async () => {
    deptA = await open(createDepartment({ name: "DeletedDept" }));
    deptB = await open(createDepartment({ name: "SurvivingDept" }));
    expect(deptA?.id).toBeTruthy();
    expect(deptB?.id).toBeTruthy();

    opId = createUser("opfirst-op", "hash", "OpFirst", null, null, { role: "operator" });
    custId = createUser("opfirst-cust", "hash", "CustFirst", null, null, { role: "user" });
    await open(setUserDepartment(opId, deptA.id));

    chatId = await open(createChat(null, "dm", { channel: "support" }));
    await open(addChatMember(chatId, custId, "owner"));
    await open(addChatMember(chatId, opId, "member"));
    await open(markChatDepartment(chatId, deptA.id));
    await open(
      createTicketRow({
        chatId,
        departmentId: deptA.id,
        customerId: custId,
        operatorId: opId,
      })
    );
    await open(createMessage(chatId, custId, "hello before deletion"));

    // Operator moves to the surviving department, then the old one is deleted.
    await open(setUserDepartment(opId, deptB.id));
    const deleted = await open(hardDeleteDepartment(deptA.id));
    expect(deleted?.name).toBe("DeletedDept");

    // The department row is gone, the ticket row is intact and anchored to
    // its operator.
    expect((await open(listDepartments({ activeOnly: false }))).some((d) => d.id === deptA.id)).toBe(false);
    const ticket = await open(getTicketByChatId(chatId));
    expect(ticket).toBeTruthy();
    expect(String(ticket.operatorId)).toBe(String(opId));
    expect(String(ticket.customerId)).toBe(String(custId));

    // The report re-attributes the orphaned ticket to the operator's CURRENT
    // department — history is not erased.
    const report = await open(getSupportReport({}));
    const surviving = report.departments.find((d) => d.id === deptB.id);
    expect(surviving.totals.conversations).toBe(1);
    expect(surviving.totals.ticketsOpened).toBe(1);
    const opEntry = surviving.operators.find((o) => String(o.id) === String(opId));
    expect(opEntry.openTickets).toBe(1);
    // Fully-attributed — no removed-departments bucket.
    expect(report.departments.find((d) => d.id === null)).toBeUndefined();

    // The overview workload card of the surviving department counts the chat.
    const overview = await open(getSupportOverview());
    const card = overview.departments.find((d) => d.id === deptB.id);
    expect(card.chats).toBe(1);
    expect(card.open).toBe(1);
    expect(overview.departments.find((d) => d.id === null)).toBeUndefined();
  });

  test("fully detached operator: orphaned tickets land in the removed-departments bucket", async () => {
    // Detach the operator too — nothing left to re-attribute onto.
    await open(setUserDepartment(opId, null));

    const report = await open(getSupportReport({}));
    const bucket = report.departments.find((d) => d.id === null);
    expect(bucket).toBeTruthy();
    expect(bucket.totals.conversations).toBe(1);
    expect(bucket.totals.ticketsOpened).toBe(1);
    expect(bucket.operators.map((o) => String(o.id))).toEqual([String(opId)]);
    // The bucket always sorts last.
    expect(report.departments[report.departments.length - 1].id).toBeNull();

    const overview = await open(getSupportOverview());
    const removedCard = overview.departments.find((d) => d.id === null);
    expect(removedCard).toBeTruthy();
    expect(removedCard.chats).toBe(1);
  });

  test("thread reuse through a new department re-tags chat + ticket to the new entry point", async () => {
    // The surviving department gets the operator back; the customer sends a
    // new request through it — findDmChat(channel:'support') reuses the pair's
    // thread and the recorded department follows the NEW entry department.
    await open(setUserDepartment(opId, deptB.id));

    await open(markChatDepartment(chatId, deptB.id));
    await open(setTicketDepartmentByChatId(chatId, deptB.id));
    await open(setTicketStatusByChatId(chatId, "open"));

    const chatDept = await open(
      (async () => {
        const { getChatDepartmentId } = await import("../../db.js");
        return getChatDepartmentId(chatId);
      })()
    );
    expect(Number(chatDept)).toBe(deptB.id);
    const ticket = await open(getTicketByChatId(chatId));
    expect(Number(ticket.departmentId)).toBe(deptB.id);
    // Still the same operator-owned thread — identity unchanged.
    expect(String(ticket.operatorId)).toBe(String(opId));
  });
});
