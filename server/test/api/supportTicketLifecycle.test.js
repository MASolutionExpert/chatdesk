import { describe, test, expect, beforeEach } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ticket lifecycle (migration 045 `tickets` table).
//
// The ticket — not the chat — owns the lifecycle:
//   * POST /api/support/request registers a ticket row for every support chat
//     (new thread → new open ticket; reused thread with a closed ticket →
//     reopened by the very request that continues it);
//   * POST /api/support/tickets/:chatId/close|reopen flips the status for the
//     chat's members (customer or staff), idempotently;
//   * a CLOSED ticket stops accepting messages (403 ticket_closed) while a
//     messenger (direct) chat — which has no ticket row — is never blocked;
//   * only support chats have a lifecycle: the lifecycle endpoints refuse
//     direct chats (400 not_a_ticket).
// ─────────────────────────────────────────────────────────────────────────────

async function loginCookie(app, username = "alice", password = "secret123") {
  const res = await request(app).post("/api/login").send({ username, password });
  return res.headers["set-cookie"];
}

describe("ticket lifecycle at the API layer", () => {
  const customerId = "11111111-1111-4111-a111-111111111111";
  const operatorId = "22222222-2222-4222-b222-222222222222";
  const outsiderId = "66666666-6666-4666-8666-666666666666";
  const supportChatId = "33333333-3333-4333-8333-333333333341";
  const directChatId = "33333333-3333-4333-8333-333333333342";
  const deptId = 7;

  function createTestApp({
    ticketByChatId,
    chatById,
    memberRoles,
  } = {}) {
    const calls = {
      createTicketRow: [],
      setTicketStatus: [],
      chatEvents: [],
    };
    const userStore = makeUserStore([
      {
        id: customerId,
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
        id: operatorId,
        username: "bob",
        password_hash: bcrypt.hashSync("secret123", 4),
        nickname: "Bob",
        avatar_url: null,
        color: "#10b981",
        status: "online",
        role: "operator",
        banned: false,
      },
      {
        id: outsiderId,
        username: "mallory",
        password_hash: bcrypt.hashSync("secret123", 4),
        nickname: "Mallory",
        avatar_url: null,
        color: "#10b981",
        status: "online",
        role: "user",
        banned: false,
      },
    ]);

    const ticketState = { ...ticketByChatId };

    const { app } = makeApp({
      userStore,
      deps: {
        isMember: () => true,
        findChatById: (chatId) =>
          chatById && chatById[chatId] ? chatById[chatId] : null,
        getChatMemberRole: (chatId, userId) =>
          (memberRoles && memberRoles[chatId]?.[userId]) || null,
        getTicketByChatId: (chatId) => ticketState[chatId] || null,
        setTicketStatusByChatId: (chatId, status) => {
          calls.setTicketStatus.push({ chatId, status });
          if (ticketState[chatId]) {
            ticketState[chatId] = {
              ...ticketState[chatId],
              status,
              closedAt: status === "closed" ? "2025-01-01T00:00:00Z" : null,
            };
          }
          return true;
        },
        createTicketRow: ({ chatId, departmentId, customerId: cId, operatorId: oId }) => {
          calls.createTicketRow.push({ chatId, departmentId, customerId: cId, operatorId: oId });
          const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
          ticketState[chatId] = {
            id,
            chatId,
            departmentId,
            customerId: cId,
            operatorId: oId,
            status: "open",
            createdAt: "2025-01-01T00:00:00Z",
            closedAt: null,
          };
          return id;
        },
        emitChatEvent: (chatId, payload) => {
          calls.chatEvents.push({ chatId, payload });
        },
        emitSseEvent: () => {},
        getDepartmentById: (id) =>
          Number(id) === deptId
            ? { id: deptId, name: "Billing", description: "", active: 1 }
            : null,
        pickOperatorForDepartment: () => ({
          id: operatorId,
          username: "bob",
          nickname: "Bob",
          color: "#10b981",
        }),
        findDmChat: () => null,
        createChat: () => supportChatId,
        addChatMember: () => {},
        markChatDepartment: () => {},
        unhideChat: () => {},
        createMessage: () => "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm",
        findUserByUsername: userStore.findUserByUsername,
      },
    });
    return { app, calls };
  }

  beforeEach(() => {});

  test("support/request registers an open ticket row for a fresh support chat", async () => {
    const { app, calls } = createTestApp();
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post("/api/support/request")
      .set("Cookie", cookie)
      .send({ departmentId: deptId, message: "I need help", creator: "alice" });

    expect(res.status).toBe(201);
    expect(res.body.channel).toBe("support");
    expect(res.body.ticket).toEqual({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "open",
    });
    expect(calls.createTicketRow).toEqual([
      {
        chatId: supportChatId,
        departmentId: deptId,
        customerId,
        operatorId,
      },
    ]);
  });

  test("support/request reopens a CLOSED ticket instead of creating a second row", async () => {
    const { app, calls } = createTestApp({
      ticketByChatId: {
        [supportChatId]: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          chatId: supportChatId,
          departmentId: deptId,
          customerId,
          operatorId,
          status: "closed",
          createdAt: "2025-01-01T00:00:00Z",
          closedAt: "2025-01-02T00:00:00Z",
        },
      },
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post("/api/support/request")
      .set("Cookie", cookie)
      .send({
        departmentId: deptId,
        message: "it broke again",
        creator: "alice",
      });

    expect(res.status).toBe(201);
    expect(res.body.ticket.status).toBe("open");
    expect(calls.createTicketRow).toHaveLength(0);
    expect(calls.setTicketStatus).toEqual([
      { chatId: supportChatId, status: "open" },
    ]);
  });

  test("close flips the ticket to closed and fans out a ticket_updated event", async () => {
    const { app, calls } = createTestApp({
      ticketByChatId: {
        [supportChatId]: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          chatId: supportChatId,
          departmentId: deptId,
          customerId,
          operatorId,
          status: "open",
          createdAt: "2025-01-01T00:00:00Z",
          closedAt: null,
        },
      },
      chatById: {
        [supportChatId]: {
          id: supportChatId,
          type: "dm",
          channel: "support",
          department_id: deptId,
        },
      },
      memberRoles: {
        [supportChatId]: { [customerId]: "owner", [operatorId]: "member" },
      },
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post(`/api/support/tickets/${supportChatId}/close`)
      .set("Cookie", cookie)
      .send({ creator: "alice" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      chatId: supportChatId,
      status: "closed",
      changed: true,
    });
    expect(calls.setTicketStatus).toEqual([
      { chatId: supportChatId, status: "closed" },
    ]);
    expect(calls.chatEvents).toHaveLength(1);
    expect(calls.chatEvents[0].payload).toMatchObject({
      type: "ticket_updated",
      chatId: supportChatId,
      status: "closed",
    });
  });

  test("close is idempotent when the ticket is already closed", async () => {
    const { app, calls } = createTestApp({
      ticketByChatId: {
        [supportChatId]: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          chatId: supportChatId,
          departmentId: deptId,
          customerId,
          operatorId,
          status: "closed",
          createdAt: "2025-01-01T00:00:00Z",
          closedAt: "2025-01-02T00:00:00Z",
        },
      },
      chatById: {
        [supportChatId]: {
          id: supportChatId,
          type: "dm",
          channel: "support",
          department_id: deptId,
        },
      },
      memberRoles: {
        [supportChatId]: { [customerId]: "owner", [operatorId]: "member" },
      },
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post(`/api/support/tickets/${supportChatId}/close`)
      .set("Cookie", cookie)
      .send({ creator: "alice" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "closed", changed: false });
    expect(calls.setTicketStatus).toHaveLength(0);
  });

  test("reopen restores an open ticket", async () => {
    const { app, calls } = createTestApp({
      ticketByChatId: {
        [supportChatId]: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          chatId: supportChatId,
          departmentId: deptId,
          customerId,
          operatorId,
          status: "closed",
          createdAt: "2025-01-01T00:00:00Z",
          closedAt: "2025-01-02T00:00:00Z",
        },
      },
      chatById: {
        [supportChatId]: {
          id: supportChatId,
          type: "dm",
          channel: "support",
          department_id: deptId,
        },
      },
      memberRoles: {
        [supportChatId]: { [customerId]: "owner", [operatorId]: "member" },
      },
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post(`/api/support/tickets/${supportChatId}/reopen`)
      .set("Cookie", cookie)
      .send({ creator: "alice" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "open", changed: true });
    expect(calls.setTicketStatus).toEqual([
      { chatId: supportChatId, status: "open" },
    ]);
  });

  test("a non-member cannot close the ticket", async () => {
    const { app } = createTestApp({
      ticketByChatId: {
        [supportChatId]: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          chatId: supportChatId,
          departmentId: deptId,
          customerId,
          operatorId,
          status: "open",
          createdAt: "2025-01-01T00:00:00Z",
          closedAt: null,
        },
      },
      chatById: {
        [supportChatId]: {
          id: supportChatId,
          type: "dm",
          channel: "support",
          department_id: deptId,
        },
      },
      memberRoles: {
        [supportChatId]: { [customerId]: "owner", [operatorId]: "member" },
      },
    });
    const cookie = await loginCookie(app, "mallory");

    const res = await request(app)
      .post(`/api/support/tickets/${supportChatId}/close`)
      .set("Cookie", cookie)
      .send({ creator: "mallory" });

    expect(res.status).toBe(403);
  });

  test("the lifecycle endpoints refuse a messenger (direct) chat", async () => {
    const { app } = createTestApp({
      chatById: {
        [directChatId]: {
          id: directChatId,
          type: "dm",
          channel: "direct",
          department_id: null,
        },
      },
      memberRoles: {
        [directChatId]: { [customerId]: "owner", [operatorId]: "member" },
      },
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post(`/api/support/tickets/${directChatId}/close`)
      .set("Cookie", cookie)
      .send({ creator: "alice" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_a_ticket");
  });

  test("a CLOSED support ticket stops accepting messages", async () => {
    // The message route needs the same stubs, wired through makeApp deps.
    const { app } = createTestApp({
      ticketByChatId: {
        [supportChatId]: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          chatId: supportChatId,
          departmentId: deptId,
          customerId,
          operatorId,
          status: "closed",
          createdAt: "2025-01-01T00:00:00Z",
          closedAt: "2025-01-02T00:00:00Z",
        },
      },
      chatById: {
        [supportChatId]: {
          id: supportChatId,
          type: "dm",
          channel: "support",
          department_id: deptId,
        },
      },
      memberRoles: {
        [supportChatId]: { [customerId]: "owner", [operatorId]: "member" },
      },
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post("/api/messages")
      .set("Cookie", cookie)
      .send({ chatId: supportChatId, username: "alice", body: "anyone there?" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket_closed");
  });

  test("a messenger chat (no ticket row) is never blocked by the lifecycle", async () => {
    const { app } = createTestApp({
      chatById: {
        [directChatId]: {
          id: directChatId,
          type: "dm",
          channel: "direct",
          department_id: null,
        },
      },
      memberRoles: {
        [directChatId]: { [customerId]: "owner", [operatorId]: "member" },
      },
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post("/api/messages")
      .set("Cookie", cookie)
      .send({ chatId: directChatId, username: "alice", body: "hello messenger" });

    // The lifecycle gate must NOT fire; the request proceeds past the ticket
    // check (later stages may still fail on stubs, but not with ticket_closed).
    expect(res.status).not.toBe(403);
    if (res.status >= 400) {
      expect(res.body.code).not.toBe("ticket_closed");
    }
  });
});
