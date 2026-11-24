import { describe, it, expect } from "vitest";
import { aggregateSupportReport } from "../../lib/supportReport.js";

// ─────────────────────────────────────────────────────────────────────────────
// Pure aggregation layer for the support performance report.
//
// The db layer (SQLite/PostgreSQL) only fetches raw rows — every metric is
// computed here, so these tests define the report contract for BOTH drivers.
// Mixed timestamp formats (ISO strings and SQLite "YYYY-MM-DD HH:MM:SS") must
// normalize identically.
// ─────────────────────────────────────────────────────────────────────────────

const DEPTS = [
  { id: 1, name: "Billing", color: "#10b981", active: 1 },
  { id: 2, name: "Technical", color: "#0ea5e9", active: 0 },
];

const OPERATORS = [
  { id: 10, username: "bob", nickname: "Bob", color: "#f59e0b", role: "operator", department_id: 1, banned: 0 },
  { id: 11, username: "carol", nickname: "Carol", color: "#8b5cf6", role: "operator", department_id: 1, banned: 0 },
  { id: 12, username: "dan", nickname: "Dan", color: "#14b8a6", role: "admin", department_id: 2, banned: 0 },
];

const USERS = [
  { id: 10, role: "operator" },
  { id: 11, role: "operator" },
  { id: 12, role: "admin" },
  { id: 30, role: "user" },
  { id: 31, role: "user" },
];

function baseInput(overrides = {}) {
  return {
    departments: DEPTS,
    operators: OPERATORS,
    chats: [],
    messages: [],
    users: USERS,
    tickets: [],
    from: null,
    to: null,
    ...overrides,
  };
}

describe("aggregateSupportReport — range validation", () => {
  it("returns null for an invalid `from`", () => {
    expect(aggregateSupportReport(baseInput({ from: "not-a-date" }))).toBeNull();
  });

  it("returns null for an invalid `to`", () => {
    expect(aggregateSupportReport(baseInput({ to: "2025-13-99" }))).toBeNull();
  });

  it("expands day-only bounds to full UTC days", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-15 00:00:00" },
          { id: 101, department_id: 1, created_at: "2025-06-15T23:59:59.999Z" },
          { id: 102, department_id: 1, created_at: "2025-06-16 00:00:00" },
        ],
        from: "2025-06-15",
        to: "2025-06-15",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    // Both boundary formats of June 15 included; June 16 excluded.
    expect(billing.totals.conversations).toBe(2);
  });
});

describe("aggregateSupportReport — conversation cohort metrics", () => {
  it("counts only conversations created in the range, but messages authored in the range in any chat age", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          // In-range cohort chat
          { id: 100, department_id: 1, created_at: "2025-06-10 09:00:00" },
          // Older chat that still sees messages in the range (activity-based)
          { id: 101, department_id: 1, created_at: "2025-01-02 09:00:00" },
          // Out-of-range chat
          { id: 102, department_id: 1, created_at: "2025-08-01 09:00:00" },
        ],
        messages: [
          { chat_id: 100, user_id: 30, created_at: "2025-06-10 09:01:00" },
          { chat_id: 101, user_id: 10, created_at: "2025-06-11 10:00:00" },
          // Out-of-range message
          { chat_id: 100, user_id: 10, created_at: "2025-09-01 10:00:00" },
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    expect(billing.totals.conversations).toBe(1); // chat 100 only
    expect(billing.totals.messages).toBe(2); // in-range messages of chats 100 + 101
    expect(billing.totals.customerMessages).toBe(1);
    expect(billing.totals.staffMessages).toBe(1);
  });

  it("classifies answered vs unanswered by the LAST message author; no-message chats are unanswered", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-10 09:00:00" }, // staff last → answered
          { id: 101, department_id: 1, created_at: "2025-06-11 09:00:00" }, // customer last → unanswered
          { id: 103, department_id: 1, created_at: "2025-06-12 09:00:00" }, // no messages → unanswered
        ],
        messages: [
          { chat_id: 100, user_id: 30, created_at: "2025-06-10 09:01:00" },
          { chat_id: 100, user_id: 10, created_at: "2025-06-10 09:05:00" },
          { chat_id: 101, user_id: 30, created_at: "2025-06-11 09:01:00" },
          { chat_id: 101, user_id: 10, created_at: "2025-06-11 09:02:00" },
          { chat_id: 101, user_id: 30, created_at: "2025-06-11 09:10:00" },
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    expect(billing.totals.answered).toBe(1);
    expect(billing.totals.unanswered).toBe(2);
  });

  it("computes department avg first response and author-attributed per-reply response times", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-10T09:00:00Z" }, // first reply +60s
          { id: 101, department_id: 1, created_at: "2025-06-10T09:00:00Z" }, // first reply +120s
          { id: 102, department_id: 1, created_at: "2025-06-10T09:00:00Z" }, // never answered
        ],
        messages: [
          { chat_id: 100, user_id: 30, created_at: "2025-06-10T09:00:20Z" },
          { chat_id: 100, user_id: 10, created_at: "2025-06-10T09:01:00Z" }, // bob: 40s after the customer
          { chat_id: 101, user_id: 31, created_at: "2025-06-10T09:01:30Z" },
          { chat_id: 101, user_id: 11, created_at: "2025-06-10T09:02:00Z" }, // carol: 30s after the customer
        ],
        from: null,
        to: null,
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    expect(billing.totals.avgFirstResponseSeconds).toBe(90);
    // Per-operator responses are attributed to the AUTHOR of each reply and
    // measured against the customer message each reply actually answers.
    const bob = billing.operators.find((o) => o.id === 10);
    const carol = billing.operators.find((o) => o.id === 11);
    expect(bob.responses).toBe(1);
    expect(bob.avgResponseSeconds).toBe(40);
    expect(carol.responses).toBe(1);
    expect(carol.avgResponseSeconds).toBe(30);
    // Chat 102 (no ticket, no reply) counts as unanswered in the department
    // totals but cannot be attributed to any operator.
    expect(billing.totals.unanswered).toBe(1);
    expect(bob.unanswered + carol.unanswered).toBe(0);
  });

  it("attributes the response time to the reply's AUTHOR, never to the ticket assignee", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          // Ticket assigned to bob, but CAROL wrote the first (fast) reply.
          { id: 100, department_id: 1, created_at: "2025-06-10T09:00:00Z" },
        ],
        messages: [
          { chat_id: 100, user_id: 30, created_at: "2025-06-10T09:01:00Z" },
          { chat_id: 100, user_id: 11, created_at: "2025-06-10T09:02:00Z" }, // carol +60s
          { chat_id: 100, user_id: 30, created_at: "2025-06-10T09:03:00Z" },
          { chat_id: 100, user_id: 10, created_at: "2025-06-10T09:04:00Z" }, // bob +60s
        ],
        tickets: [
          { chat_id: 100, department_id: 1, customer_id: 30, operator_id: 10, status: "open", created_at: "2025-06-10T09:00:00Z", closed_at: null },
        ],
        from: null,
        to: null,
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    const bob = billing.operators.find((o) => o.id === 10);
    const carol = billing.operators.find((o) => o.id === 11);
    // Conversation ownership still follows the ticket (bob).
    expect(bob.assigned).toBe(1);
    expect(bob.answered).toBe(1);
    expect(carol.assigned).toBe(0);
    // But EACH author is scored on their OWN reply latency.
    expect(carol.responses).toBe(1);
    expect(carol.avgResponseSeconds).toBe(60);
    expect(bob.responses).toBe(1);
    expect(bob.avgResponseSeconds).toBe(60);
  });

  it("counts every in-range reply, measuring latency from the latest preceding customer message", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-10T09:00:00Z" },
        ],
        messages: [
          { chat_id: 100, user_id: 30, created_at: "2025-06-10T09:00:00Z" },
          { chat_id: 100, user_id: 10, created_at: "2025-06-10T09:05:00Z" }, // bob +300s
          { chat_id: 100, user_id: 30, created_at: "2025-06-10T09:10:00Z" },
          { chat_id: 100, user_id: 10, created_at: "2025-06-10T09:12:00Z" }, // bob +120s
          { chat_id: 100, user_id: 30, created_at: "2025-06-10T09:15:00Z" },
          { chat_id: 100, user_id: 10, created_at: "2025-06-10T09:16:00Z" }, // bob +60s
          // Carol chimes in WITHOUT a new customer question before her reply
          // — not a response, so it must not enter anyone's average.
          { chat_id: 100, user_id: 11, created_at: "2025-06-10T09:17:00Z" },
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    const bob = billing.operators.find((o) => o.id === 10);
    const carol = billing.operators.find((o) => o.id === 11);
    expect(bob.responses).toBe(3);
    expect(bob.avgResponseSeconds).toBe(160); // (300 + 120 + 60) / 3
    expect(carol.responses).toBe(0);
    expect(carol.avgResponseSeconds).toBeNull();
  });

  it("scores replies on any chat age (activity-based) even when the request was pending before the range", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          // Old chat, customer asked in May, operator answered in June.
          { id: 100, department_id: 1, created_at: "2025-01-02T09:00:00Z" },
        ],
        messages: [
          { chat_id: 100, user_id: 30, created_at: "2025-05-01T09:00:00Z" },
          { chat_id: 100, user_id: 10, created_at: "2025-06-10T09:00:00Z" }, // +40 days
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    const bob = billing.operators.find((o) => o.id === 10);
    expect(bob.responses).toBe(1);
    expect(bob.avgResponseSeconds).toBe(40 * 24 * 3600);
  });

  it("excludes first staff replies written after the window end from the department average", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          // Created at the very end of June, answered on July 2.
          { id: 100, department_id: 1, created_at: "2025-06-30T09:00:00Z" },
        ],
        messages: [
          { chat_id: 100, user_id: 30, created_at: "2025-06-30T09:01:00Z" },
          { chat_id: 100, user_id: 10, created_at: "2025-07-02T09:00:00Z" },
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    // The conversation still exists in the June cohort and (retrospectively)
    // counts as answered, but its response time was never visible in June.
    expect(billing.totals.conversations).toBe(1);
    expect(billing.totals.answered).toBe(1);
    expect(billing.totals.avgFirstResponseSeconds).toBeNull();
    const bob = billing.operators.find((o) => o.id === 10);
    expect(bob.responses).toBe(0);
    expect(bob.avgResponseSeconds).toBeNull();
  });

  it("attributes a conversation to the ticket operator, falling back to the first staff reply author", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-10T09:00:00Z" }, // ticket → bob
          { id: 101, department_id: 1, created_at: "2025-06-10T09:00:00Z" }, // no ticket → carol (first reply)
        ],
        messages: [
          { chat_id: 100, user_id: 10, created_at: "2025-06-10T09:01:00Z" },
          { chat_id: 101, user_id: 30, created_at: "2025-06-10T09:01:00Z" },
          { chat_id: 101, user_id: 11, created_at: "2025-06-10T09:02:00Z" },
        ],
        tickets: [
          { chat_id: 100, department_id: 1, customer_id: 30, operator_id: 10, status: "open", created_at: "2025-06-10T09:00:00Z", closed_at: null },
        ],
        from: null,
        to: null,
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    const bob = billing.operators.find((o) => o.id === 10);
    const carol = billing.operators.find((o) => o.id === 11);
    expect(bob.assigned).toBe(1);
    expect(carol.assigned).toBe(1);
  });

  it("counts every in-range message of an attributed conversation for that operator (messages + customer split)", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-10T09:00:00Z" }, // → bob (ticket)
          { id: 101, department_id: 1, created_at: "2025-01-02T09:00:00Z" }, // older chat, no ticket → carol via first reply
        ],
        messages: [
          // Chat 100: 2 customer + 1 bob message in range
          { chat_id: 100, user_id: 30, created_at: "2025-06-10T09:01:00Z" },
          { chat_id: 100, user_id: 10, created_at: "2025-06-10T09:02:00Z" },
          { chat_id: 100, user_id: 30, created_at: "2025-06-10T09:03:00Z" },
          // Out-of-range message of chat 100 → not counted
          { chat_id: 100, user_id: 30, created_at: "2025-09-01T09:00:00Z" },
          // Chat 101 (attributed to carol): 1 customer + 1 carol reply in range
          { chat_id: 101, user_id: 31, created_at: "2025-06-11T09:01:00Z" },
          { chat_id: 101, user_id: 11, created_at: "2025-06-11T09:02:00Z" },
        ],
        tickets: [
          { chat_id: 100, department_id: 1, customer_id: 30, operator_id: 10, status: "open", created_at: "2025-06-10T09:00:00Z", closed_at: null },
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    const bob = billing.operators.find((o) => o.id === 10);
    const carol = billing.operators.find((o) => o.id === 11);
    // Bob owns chat 100 → 3 in-range messages, 2 of them from the customer.
    expect(bob.messagesInConversations).toBe(3);
    expect(bob.customerMessages).toBe(2);
    // His own reply is counted separately as messagesSent.
    expect(bob.messagesSent).toBe(1);
    // Carol owns the older chat 101 via first-reply fallback.
    expect(carol.messagesInConversations).toBe(2);
    expect(carol.customerMessages).toBe(1);
    expect(carol.messagesSent).toBe(1);
    // Department totals remain message-based, not operator-sum based.
    expect(billing.totals.messages).toBe(5);
    expect(billing.totals.customerMessages).toBe(3);
    expect(billing.totals.staffMessages).toBe(2);
  });

  it("reports still-open tickets per operator", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-10T09:00:00Z" },
          { id: 101, department_id: 1, created_at: "2025-06-11T09:00:00Z" },
          { id: 102, department_id: 1, created_at: "2025-06-12T09:00:00Z" },
        ],
        tickets: [
          { chat_id: 100, department_id: 1, customer_id: 30, operator_id: 10, status: "closed", created_at: "2025-06-10T09:00:00Z", closed_at: "2025-06-12T10:00:00Z" },
          { chat_id: 101, department_id: 1, customer_id: 30, operator_id: 10, status: "open", created_at: "2025-06-11T09:00:00Z", closed_at: null },
          { chat_id: 102, department_id: 1, customer_id: 31, operator_id: 11, status: "open", created_at: "2025-06-12T09:00:00Z", closed_at: null },
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    const bob = billing.operators.find((o) => o.id === 10);
    const carol = billing.operators.find((o) => o.id === 11);
    expect(bob.ticketsOpened).toBe(2);
    expect(bob.openTickets).toBe(1); // the closed one no longer counts
    expect(carol.ticketsOpened).toBe(1);
    expect(carol.openTickets).toBe(1);
    expect(billing.totals.openTickets).toBe(2);
  });
});

describe("aggregateSupportReport — ticket metrics", () => {
  it("counts opened/closed/still-open tickets in the range per operator", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-10T09:00:00Z" },
          { id: 101, department_id: 1, created_at: "2025-06-11T09:00:00Z" },
          { id: 102, department_id: 1, created_at: "2025-06-12T09:00:00Z" },
        ],
        tickets: [
          { chat_id: 100, department_id: 1, customer_id: 30, operator_id: 10, status: "closed", created_at: "2025-06-10T09:00:00Z", closed_at: "2025-06-12T10:00:00Z" },
          { chat_id: 101, department_id: 1, customer_id: 30, operator_id: 10, status: "open", created_at: "2025-06-11T09:00:00Z", closed_at: null },
          // Opened before the range, closed inside it → counts as closed only
          { chat_id: 102, department_id: 1, customer_id: 30, operator_id: 11, status: "closed", created_at: "2025-05-01T09:00:00Z", closed_at: "2025-06-12T11:00:00Z" },
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    expect(billing.totals.ticketsOpened).toBe(2);
    expect(billing.totals.ticketsClosed).toBe(2);
    expect(billing.totals.openTickets).toBe(1);
    const bob = billing.operators.find((o) => o.id === 10);
    const carol = billing.operators.find((o) => o.id === 11);
    expect(bob.ticketsOpened).toBe(2);
    expect(bob.ticketsClosed).toBe(1);
    expect(carol.ticketsClosed).toBe(1);
  });

  it("treats a closed ticket opened before the range as not open in-range", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [{ id: 100, department_id: 1, created_at: "2025-05-01T09:00:00Z" }],
        tickets: [
          { chat_id: 100, department_id: 1, customer_id: 30, operator_id: 10, status: "closed", created_at: "2025-05-01T09:00:00Z", closed_at: null },
        ],
        from: "2025-06-01",
        to: null,
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    expect(billing.totals.ticketsOpened).toBe(0);
    expect(billing.totals.openTickets).toBe(0);
  });
});

describe("aggregateSupportReport — department/operator scoping", () => {
  it("keeps departments isolated and lists inactive operators of a department with zeros", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [
          { id: 100, department_id: 1, created_at: "2025-06-10T09:00:00Z" },
          { id: 200, department_id: 2, created_at: "2025-06-10T09:00:00Z" },
        ],
        messages: [
          { chat_id: 200, user_id: 12, created_at: "2025-06-10T10:00:00Z" },
        ],
        tickets: [
          { chat_id: 200, department_id: 2, customer_id: 31, operator_id: 12, status: "open", created_at: "2025-06-10T09:00:00Z", closed_at: null },
        ],
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    const technical = report.departments.find((d) => d.id === 2);
    expect(billing.totals.conversations).toBe(1);
    expect(billing.totals.messages).toBe(0);
    expect(technical.totals.conversations).toBe(1);
    expect(technical.totals.staffMessages).toBe(1);
    // Dan has no activity in Billing — his metrics live only in Technical.
    const danInTechnical = technical.operators.find((o) => o.id === 12);
    expect(danInTechnical.messagesSent).toBe(1);
    expect(billing.operators.find((o) => o.id === 12)).toBeUndefined();
    // Inactive department still reports (history stays meaningful).
    expect(technical.active).toBe(false);
    // Zero-activity operator Carol still appears in the Billing roster.
    const carol = billing.operators.find((o) => o.id === 11);
    expect(carol.assigned).toBe(0);
    expect(carol.messagesSent).toBe(0);
  });

  it("sorts departments by name and operators by username", () => {
    const report = aggregateSupportReport(baseInput());
    expect(report.departments.map((d) => d.name)).toEqual(["Billing", "Technical"]);
    const billing = report.departments.find((d) => d.id === 1);
    expect(billing.operators.map((o) => o.username)).toEqual(["bob", "carol"]);
  });

  it("includes range echo and range-independent unanswered fallback for SQLite timestamps", () => {
    const report = aggregateSupportReport(
      baseInput({
        chats: [{ id: 100, department_id: 1, created_at: "2025-06-10 09:00:00" }],
        messages: [
          { chat_id: 100, user_id: 30, created_at: "2025-06-10 09:01:00" },
        ],
        from: "2025-06-01",
        to: "2025-06-30",
      })
    );
    expect(report.range).toEqual({ from: "2025-06-01", to: "2025-06-30" });
    const billing = report.departments.find((d) => d.id === 1);
    expect(billing.totals.unanswered).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — production id shapes.
//
// Migration 036 made users / chats / chat_messages primary keys TEXT UUIDs.
// The aggregation layer once keyed every map by Number(id), which is NaN for
// a UUID — and because Maps match NaN via SameValueZero, EVERY operator /
// chat / message collapsed onto one "last row wins" bucket. The visible
// symptom was the department report showing performance for ONLY THE LAST
// OPERATOR of the department. These tests pin the real production shapes:
// UUID string ids for users/chats/messages/tickets.chat_id/operator_id and
// INTEGER ids for departments.
// ─────────────────────────────────────────────────────────────────────────────
describe("aggregateSupportReport — UUID id shapes (migration 036 production reality)", () => {
  // Integer department ids (departments table was never UUID-converted).
  const UUID_DEPTS = [
    { id: 1, name: "Billing", color: "#10b981", active: 1 },
  ];

  const UUIDS = {
    bob: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    carol: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
    dan: "3f2504e0-4f89-11d3-9a0c-0305e82c3303",
    cust1: "9f8a1b2c-3d4e-4f5a-86b7-c8d9e0f1a2b3",
    cust2: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    chat1: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    chat2: "6ba7b811-9dad-11d1-80b4-00c04fd430c9",
    chat3: "6ba7b812-9dad-11d1-80b4-00c04fd430ca",
  };

  // Three operators on ONE department roster — the old NaN-keyed code
  // collapsed them into a single "last operator wins" entry.
  const UUID_OPERATORS = [
    { id: UUIDS.bob, username: "bob", nickname: "Bob", color: "#f59e0b", role: "operator", department_id: 1, banned: 0 },
    { id: UUIDS.carol, username: "carol", nickname: "Carol", color: "#8b5cf6", role: "operator", department_id: 1, banned: 0 },
    { id: UUIDS.dan, username: "dan", nickname: "Dan", color: "#14b8a6", role: "operator", department_id: 1, banned: 0 },
  ];

  const UUID_USERS = [
    { id: UUIDS.bob, role: "operator" },
    { id: UUIDS.carol, role: "operator" },
    { id: UUIDS.dan, role: "operator" },
    { id: UUIDS.cust1, role: "user" },
    { id: UUIDS.cust2, role: "user" },
  ];

  function uuidInput(overrides = {}) {
    return {
      departments: UUID_DEPTS,
      operators: UUID_OPERATORS,
      chats: [],
      messages: [],
      users: UUID_USERS,
      tickets: [],
      from: null,
      to: null,
      ...overrides,
    };
  }

  it("lists ALL operators of the department, not just the last one", () => {
    const report = aggregateSupportReport(uuidInput());
    const billing = report.departments.find((d) => d.id === 1);
    expect(billing.operatorCount).toBe(3);
    expect(billing.operators.map((o) => o.username)).toEqual(["bob", "carol", "dan"]);
  });

  it("attributes each conversation to ITS OWN operator via the ticket row", () => {
    const report = aggregateSupportReport(
      uuidInput({
        chats: [
          { id: UUIDS.chat1, department_id: 1, created_at: "2025-06-10T09:00:00Z" },
          { id: UUIDS.chat2, department_id: 1, created_at: "2025-06-11T09:00:00Z" },
          { id: UUIDS.chat3, department_id: 1, created_at: "2025-06-12T09:00:00Z" },
        ],
        messages: [
          { chat_id: UUIDS.chat1, user_id: UUIDS.cust1, created_at: "2025-06-10T09:01:00Z" },
          { chat_id: UUIDS.chat1, user_id: UUIDS.bob, created_at: "2025-06-10T09:02:00Z" },
          { chat_id: UUIDS.chat2, user_id: UUIDS.cust2, created_at: "2025-06-11T09:01:00Z" },
          { chat_id: UUIDS.chat2, user_id: UUIDS.carol, created_at: "2025-06-11T09:02:00Z" },
          { chat_id: UUIDS.chat3, user_id: UUIDS.cust1, created_at: "2025-06-12T09:01:00Z" },
          { chat_id: UUIDS.chat3, user_id: UUIDS.dan, created_at: "2025-06-12T09:02:00Z" },
        ],
        tickets: [
          { chat_id: UUIDS.chat1, department_id: 1, customer_id: UUIDS.cust1, operator_id: UUIDS.bob, status: "open", created_at: "2025-06-10T09:00:00Z", closed_at: null },
          { chat_id: UUIDS.chat2, department_id: 1, customer_id: UUIDS.cust2, operator_id: UUIDS.carol, status: "open", created_at: "2025-06-11T09:00:00Z", closed_at: null },
          { chat_id: UUIDS.chat3, department_id: 1, customer_id: UUIDS.cust1, operator_id: UUIDS.dan, status: "open", created_at: "2025-06-12T09:00:00Z", closed_at: null },
        ],
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    // Every operator gets exactly their own conversation — not the last
    // operator receiving all three.
    expect(billing.operators.find((o) => o.id === UUIDS.bob).assigned).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.carol).assigned).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.dan).assigned).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.bob).answered).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.carol).answered).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.dan).answered).toBe(1);
    // Staff/customer split must classify by the AUTHOR's own role (UUID user
    // ids) — the old NaN-keyed role map classified everyone as the last user.
    expect(billing.operators.find((o) => o.id === UUIDS.bob).messagesSent).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.carol).messagesSent).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.dan).messagesSent).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.bob).customerMessages).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.carol).customerMessages).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.dan).customerMessages).toBe(1);
    expect(billing.totals.staffMessages).toBe(3);
    expect(billing.totals.customerMessages).toBe(3);
    // First-response attribution also lands on the right operator (each
    // operator authored the only reply of their own chat).
    expect(billing.operators.find((o) => o.id === UUIDS.bob).responses).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.carol).responses).toBe(1);
    expect(billing.operators.find((o) => o.id === UUIDS.dan).responses).toBe(1);
  });

  it("keeps per-chat message histories separate under UUID chat ids", () => {
    const report = aggregateSupportReport(
      uuidInput({
        chats: [
          // chat1: staff last → answered; chat2: customer last → unanswered
          { id: UUIDS.chat1, department_id: 1, created_at: "2025-06-10T09:00:00Z" },
          { id: UUIDS.chat2, department_id: 1, created_at: "2025-06-11T09:00:00Z" },
        ],
        messages: [
          { chat_id: UUIDS.chat1, user_id: UUIDS.cust1, created_at: "2025-06-10T09:01:00Z" },
          { chat_id: UUIDS.chat1, user_id: UUIDS.bob, created_at: "2025-06-10T09:02:00Z" },
          { chat_id: UUIDS.chat2, user_id: UUIDS.cust2, created_at: "2025-06-11T09:01:00Z" },
        ],
        tickets: [
          { chat_id: UUIDS.chat1, department_id: 1, customer_id: UUIDS.cust1, operator_id: UUIDS.bob, status: "open", created_at: "2025-06-10T09:00:00Z", closed_at: null },
          { chat_id: UUIDS.chat2, department_id: 1, customer_id: UUIDS.cust2, operator_id: UUIDS.carol, status: "open", created_at: "2025-06-11T09:00:00Z", closed_at: null },
        ],
      })
    );
    const billing = report.departments.find((d) => d.id === 1);
    // The old NaN-keyed messagesByChat merged BOTH chats' messages into one
    // bucket, making every conversation look answered (global last message
    // was staff) — answered/unanswered must be judged PER CHAT.
    expect(billing.totals.answered).toBe(1);
    expect(billing.totals.unanswered).toBe(1);
    const carol = billing.operators.find((o) => o.id === UUIDS.carol);
    expect(carol.unanswered).toBe(1);
    expect(carol.messagesInConversations).toBe(1);
    const bob = billing.operators.find((o) => o.id === UUIDS.bob);
    expect(bob.messagesInConversations).toBe(2);
    // Ticket metrics stay per-operator under UUID operator ids.
    expect(bob.openTickets).toBe(1);
    expect(carol.openTickets).toBe(1);
  });
});
