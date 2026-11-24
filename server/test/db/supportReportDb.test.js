import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// getSupportReport — REAL database integration (SQLite).
//
// The API tests mock this function and the pure aggregation tests feed it
// hand-built rows, so for a while NOTHING exercised the actual
// db.js → aggregateSupportReport path. The gap hid a production incident:
// migration 036 made users/chats/chat_messages ids TEXT UUIDs, the first
// aggregation draft keyed its maps by Number(id) (NaN for UUIDs), and the
// department report collapsed to "only the last operator has performance".
//
// These tests build a real department with THREE operators, real support
// chats, tickets and messages through the public db.js API, then assert the
// report end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; this suite is SQLite-only.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-support-report-"));

const {
  createUser,
  createChat,
  addChatMember,
  createDepartment,
  markChatDepartment,
  setUserDepartment,
  createTicketRow,
  createMessage,
  getSupportReport,
} = await import("../../db.js");

const sync = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

describe("getSupportReport — real database integration", () => {
  let dept, bobId, carolId, danId, cust1, cust2, chat1, chat2, chat3;

  const open = async (promiseOrValue) => sync(promiseOrValue);

  // Fixture build (SQLite mode is synchronous; sync() no-ops on plain values).
  const buildFixtures = async () => {
    dept = await open(createDepartment({ name: "Billing", description: "b" }));
    expect(dept?.id).toBeTruthy();

    // Three operators on the department roster.
    bobId = createUser("report-bob", "hash", "Bob", null, null, { role: "operator" });
    carolId = createUser("report-carol", "hash", "Carol", null, null, { role: "operator" });
    danId = createUser("report-dan", "hash", "Dan", null, null, { role: "operator" });
    await open(setUserDepartment(bobId, dept.id));
    await open(setUserDepartment(carolId, dept.id));
    await open(setUserDepartment(danId, dept.id));

    // Two customers.
    cust1 = createUser("report-cust1", "hash", "Cust1", null, null, { role: "user" });
    cust2 = createUser("report-cust2", "hash", "Cust2", null, null, { role: "user" });

    // Support chat 1 → bob: customer asks, bob replies (answered).
    chat1 = await open(createChat(null, "dm", { channel: "support" }));
    await open(addChatMember(chat1, cust1, "owner"));
    await open(addChatMember(chat1, bobId, "member"));
    await open(markChatDepartment(chat1, dept.id));
    await open(createTicketRow({ chatId: chat1, departmentId: dept.id, customerId: cust1, operatorId: bobId }));
    await open(createMessage(chat1, cust1, "hello, I need help"));
    await open(createMessage(chat1, bobId, "sure, how can I help?"));

    // Support chat 2 → carol: customer asks, nobody replied (unanswered).
    chat2 = await open(createChat(null, "dm", { channel: "support" }));
    await open(addChatMember(chat2, cust2, "owner"));
    await open(addChatMember(chat2, carolId, "member"));
    await open(markChatDepartment(chat2, dept.id));
    await open(createTicketRow({ chatId: chat2, departmentId: dept.id, customerId: cust2, operatorId: carolId }));
    await open(createMessage(chat2, cust2, "anyone there?"));

    // Support chat 3 → dan: no messages at all (unanswered, dan's ticket).
    chat3 = await open(createChat(null, "dm", { channel: "support" }));
    await open(addChatMember(chat3, cust1, "owner"));
    await open(addChatMember(chat3, danId, "member"));
    await open(markChatDepartment(chat3, dept.id));
    await open(createTicketRow({ chatId: chat3, departmentId: dept.id, customerId: cust1, operatorId: danId }));
  };

  const ready = buildFixtures();

  test("returns every operator of the department — not just the last one", async () => {
    await ready;
    const report = await sync(
      getSupportReport({ departmentId: dept.id, from: null, to: null })
    );
    expect(report).toBeTruthy();
    expect(report.departments).toHaveLength(1);
    const billing = report.departments[0];
    expect(billing.id).toBe(Number(dept.id));
    expect(billing.operatorCount).toBe(3);
    expect(billing.operators.map((o) => o.username)).toEqual([
      "report-bob",
      "report-carol",
      "report-dan",
    ]);
  });

  test("attributes each conversation, messages and first response to its own operator", async () => {
    await ready;
    const report = await sync(
      getSupportReport({ departmentId: dept.id, from: null, to: null })
    );
    const billing = report.departments[0];
    const byName = new Map(billing.operators.map((o) => [o.username, o]));
    const bob = byName.get("report-bob");
    const carol = byName.get("report-carol");
    const dan = byName.get("report-dan");

    // Conversation attribution follows the ticket's operator.
    expect(bob.assigned).toBe(1);
    expect(carol.assigned).toBe(1);
    expect(dan.assigned).toBe(1);
    expect(bob.answered).toBe(1);
    expect(carol.unanswered).toBe(1);
    expect(dan.unanswered).toBe(1);

    // Department cohort totals.
    expect(billing.totals.conversations).toBe(3);
    expect(billing.totals.answered).toBe(1);
    expect(billing.totals.unanswered).toBe(2);

    // Message counts: chat1 has 2 messages (1 customer + 1 staff),
    // chat2 has 1 (customer), chat3 has 0.
    expect(billing.totals.messages).toBe(3);
    expect(billing.totals.customerMessages).toBe(2);
    expect(billing.totals.staffMessages).toBe(1);
    expect(bob.messagesSent).toBe(1);
    expect(carol.messagesSent).toBe(0);
    expect(dan.messagesSent).toBe(0);
    expect(bob.messagesInConversations).toBe(2);
    expect(carol.messagesInConversations).toBe(1);
    expect(dan.messagesInConversations).toBe(0);

    // First response only for bob (his ticket got the only staff reply).
    expect(bob.firstResponses).toBe(1);
    expect(carol.firstResponses).toBe(0);
    expect(dan.firstResponses).toBe(0);
    // Computed (fixture messages land within the same second → 0s is valid),
    // and attributed: bob's own average mirrors the department total.
    expect(billing.totals.avgFirstResponseSeconds).not.toBeNull();
    expect(bob.avgFirstResponseSeconds).toBe(billing.totals.avgFirstResponseSeconds);

    // Ticket registry metrics per operator.
    expect(bob.ticketsOpened).toBe(1);
    expect(carol.ticketsOpened).toBe(1);
    expect(dan.ticketsOpened).toBe(1);
    expect(billing.totals.ticketsOpened).toBe(3);
    expect(billing.totals.openTickets).toBe(3);
  });

  test("filters the cohort by an exclusive future range (empty report, roster intact)", async () => {
    await ready;
    const report = await sync(
      getSupportReport({
        departmentId: dept.id,
        from: "1999-01-01",
        to: "1999-01-02",
      })
    );
    const billing = report.departments[0];
    expect(billing.totals.conversations).toBe(0);
    expect(billing.totals.messages).toBe(0);
    // The operator roster is range-independent — all three always appear.
    expect(billing.operators).toHaveLength(3);
    expect(billing.operators.every((o) => o.assigned === 0)).toBe(true);
  });
});
