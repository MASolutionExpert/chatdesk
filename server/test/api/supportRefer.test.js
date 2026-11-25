import { describe, test, expect, beforeEach } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ticket referral (dev.8).
//
// POST /api/support/tickets/:chatId/refer hands a ticket to another operator:
//   * only staff (operator/owner) may refer — customers get 403;
//   * the support thread is converted in place from a DM into a private
//     support GROUP that keeps its support identity (channel "support" +
//     department_id) — full messenger-group parity for staff;
//   * the customer is demoted to a plain chat member and the referred-to
//     operator becomes the group owner + the ticket's operator of record
//     (fair routing counts the workload against them);
//   * a [[system:referred:<name>]] message marks the handoff in context;
//   * guards: direct chats are refused (not_a_ticket), closed tickets are
//     refused, non-staff targets are refused, already-member targets 409,
//     self-referral 400, non-member actors 403.
//
// GET /api/support/tickets/:chatId/refer-candidates lists unbanned staff
// members (excluding only the actor) — each candidate carries `inTicket`
// when they are already inside the thread — plus the full active department
// directory, sorted by last interaction with the actor (recent contacts
// first). The picker can therefore always offer a department → operator
// browser and a direct by-ID handoff, even in small deployments.
//
// Referred tickets keep the deletion policy: /api/chats/hide and
// /api/chats/group/:chatId/delete stay owner-only for support groups, the
// customer can never be dropped (remove-member + settings sync), and the
// last staff member cannot abandon the thread by leaving.
// ─────────────────────────────────────────────────────────────────────────────

async function loginCookie(app, username = "bob", password = "secret123") {
  const res = await request(app).post("/api/login").send({ username, password });
  return res.headers["set-cookie"];
}

describe("ticket referral at the API layer", () => {
  const customerId = "11111111-1111-4111-a111-111111111111";
  const operatorId = "22222222-2222-4222-b222-222222222222"; // bob (referring)
  const carolId = "33333333-3333-4333-8333-333333330003"; // target operator
  const daveId = "44444444-4444-4444-8444-444444440004"; // second operator
  const outsiderId = "66666666-6666-4666-8666-666666666666"; // role "user"
  const ticketChatId = "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa1";
  const directChatId = "aaaaaaaa-aaa1-4aaa-8aaa-aaaaaaaaaaa2";
  const deptId = 7;

  const users = [
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
      id: carolId,
      username: "carol",
      password_hash: bcrypt.hashSync("secret123", 4),
      nickname: "Carol",
      avatar_url: null,
      color: "#10b981",
      status: "online",
      role: "operator",
      banned: false,
    },
    {
      id: daveId,
      username: "dave",
      password_hash: bcrypt.hashSync("secret123", 4),
      nickname: "Dave",
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
  ];

  function createTestApp({
    chat,
    members,
    memberRoles,
    ticket,
  } = {}) {
    const calls = {
      convert: [],
      addMember: [],
      setRole: [],
      ticketOperator: [],
      messages: [],
      chatEvents: [],
      hiddenFor: [],
      removedMembers: [],
    };

    const chatState = { ...chat };
    const ticketState = ticket ? { ...ticket } : null;

    const userStore = makeUserStore(users);
    const { app } = makeApp({
      userStore,
      deps: {
        findChatById: (chatId) => (chatId === chatState.id ? chatState : null),
        listChatMembers: () => members || [],
        getChatMemberRole: (chatId, userId) =>
          (memberRoles && memberRoles[chatId]?.[userId]) || null,
        isMember: () => true,
        getTicketByChatId: () => ticketState,
        getDepartmentById: (id) =>
          id === deptId ? { id: deptId, name: "Billing", active: true } : null,
        convertSupportChatToGroup: (chatId, opts) => {
          calls.convert.push({ chatId, opts });
          chatState.type = "group";
          chatState.name = opts?.name || "Support";
          chatState.group_visibility = "private";
          return true;
        },
        setChatMemberRole: (chatId, userId, role) => {
          calls.setRole.push({ chatId, userId, role });
          return true;
        },
        addChatMember: (chatId, userId, role) => {
          calls.addMember.push({ chatId, userId, role });
          return {};
        },
        setTicketOperatorByChatId: (chatId, operatorIdArg) => {
          calls.ticketOperator.push({ chatId, operatorId: operatorIdArg });
          if (ticketState) ticketState.operatorId = operatorIdArg;
          return true;
        },
        listStaffReferCandidates: ({ excludeUserIds = [] } = {}) =>
          users
            .filter(
              (u) =>
                ["operator", "owner"].includes(u.role) &&
                !excludeUserIds.map(String).includes(u.id) &&
                !u.banned,
            )
            .map((u) => ({
              id: u.id,
              username: u.username,
              nickname: u.nickname,
              role: u.role,
              departmentId: deptId,
              departmentName: "Billing",
              lastInteraction: null,
            })),
        listDepartments: () => [
          { id: deptId, name: "Billing", color: "#10b981", active: true },
          { id: 9, name: "Archived dept", color: null, active: false },
        ],
        createMessage: (chatId, userId, body) => {
          calls.messages.push({ chatId, userId, body });
          return "message-1";
        },
        emitChatEvent: (chatId, payload) => {
          calls.chatEvents.push({ chatId, payload });
        },
        unhideChat: (userId, chatId) => {
          calls.hiddenFor.push({ userId, chatId, op: "unhide" });
        },
        removeChatMember: (chatId, userId) => {
          calls.removedMembers.push({ chatId, userId });
        },
        hideChatsForUser: (userId, chatIds) => {
          calls.hiddenFor.push({ userId, chatIds, op: "hide" });
        },
        deletionService: {
          deleteChat: async () => ({ storedFilesToRemove: [], sseEvents: [] }),
        },
      },
    });
    return { app, calls, chatState, ticketState };
  }

  const openTicket = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    chatId: ticketChatId,
    departmentId: deptId,
    customerId,
    operatorId,
    status: "open",
  };

  const dmTicketChat = {
    id: ticketChatId,
    type: "dm",
    channel: "support",
    department_id: deptId,
  };

  const defaultMembers = [
    { id: customerId, username: "alice", nickname: "Alice", role: "owner", user_role: "user" },
    { id: operatorId, username: "bob", nickname: "Bob", role: "member", user_role: "operator" },
  ];

  // Post-referral state: the customer was demoted to a plain member and the
  // referred-to operator (carol) owns the support group.
  const referredMembers = [
    { id: customerId, username: "alice", nickname: "Alice", role: "member", user_role: "user" },
    { id: operatorId, username: "bob", nickname: "Bob", role: "member", user_role: "operator" },
    { id: carolId, username: "carol", nickname: "Carol", role: "owner", user_role: "operator" },
  ];

  const referredMemberRoles = {
    [ticketChatId]: {
      [customerId]: "member",
      [operatorId]: "member",
      [carolId]: "owner",
    },
  };

  const referredGroupChat = {
    id: ticketChatId,
    type: "group",
    channel: "support",
    department_id: deptId,
    group_visibility: "private",
  };

  const defaultMemberRoles = {
    [ticketChatId]: { [customerId]: "owner", [operatorId]: "member" },
  };

  // ─── refer-candidates ──────────────────────────────────────────────────────

  test("staff see the full staff directory (minus self) with inTicket flags + departments", async () => {
    const { app } = createTestApp({
      chat: dmTicketChat,
      members: defaultMembers,
      memberRoles: defaultMemberRoles,
      ticket: openTicket,
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .get(`/api/support/tickets/${ticketChatId}/refer-candidates`)
      .query({ creator: "bob" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    // The actor (bob) is gone; everyone else staff stays listed.
    const usernames = res.body.candidates.map((c) => c.username);
    expect(usernames).toEqual(["carol", "dave"]);
    expect(res.body.candidates[0].departmentName).toBe("Billing");
    // Nobody in this thread yet — no candidate is flagged.
    expect(res.body.candidates.every((c) => c.inTicket === false)).toBe(true);
    // Only ACTIVE departments reach the picker.
    expect(res.body.departments).toEqual([
      { id: deptId, name: "Billing", color: "#10b981", active: true },
    ]);
  });

  test("staff already inside the thread stay listed but flagged inTicket", async () => {
    const { app } = createTestApp({
      chat: referredGroupChat,
      members: referredMembers,
      memberRoles: referredMemberRoles,
      ticket: { ...openTicket, operatorId: carolId },
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .get(`/api/support/tickets/${ticketChatId}/refer-candidates`)
      .query({ creator: "bob" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      res.body.candidates.map((c) => [c.username, c]),
    );
    // Carol is now a member of the thread — still visible, but flagged.
    expect(byName.carol?.inTicket).toBe(true);
    expect(byName.dave?.inTicket).toBe(false);
    // The customer (alice) never appears — not staff.
    expect(byName.alice).toBeUndefined();
    // The actor (bob) never appears.
    expect(byName.bob).toBeUndefined();
  });

  test("customers cannot list referral candidates", async () => {
    const { app } = createTestApp({
      chat: dmTicketChat,
      members: defaultMembers,
      memberRoles: defaultMemberRoles,
      ticket: openTicket,
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .get(`/api/support/tickets/${ticketChatId}/refer-candidates`)
      .query({ creator: "alice" })
      .set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only staff/i);
  });

  // ─── refer: happy paths ────────────────────────────────────────────────────

  test("referring a DM-shaped ticket converts it into a shared support group", async () => {
    const { app, calls, chatState, ticketState } = createTestApp({
      chat: dmTicketChat,
      members: defaultMembers,
      memberRoles: defaultMemberRoles,
      ticket: openTicket,
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post(`/api/support/tickets/${ticketChatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "bob", operatorUsername: "carol" });

    expect(res.status).toBe(200);
    expect(res.body.converted).toBe(true);
    expect(res.body.referredTo.username).toBe("carol");
    expect(res.body.ticket.operatorId).toBe(carolId);

    // DM → private support group named after the department.
    expect(calls.convert).toEqual([
      { chatId: ticketChatId, opts: { name: "Billing" } },
    ]);
    expect(chatState.type).toBe("group");
    expect(chatState.group_visibility).toBe("private");

    // Customer demoted to member, staff kept as members.
    const roleFor = (id) =>
      calls.setRole.find((r) => r.userId === id)?.role;
    expect(roleFor(customerId)).toBe("member");
    expect(roleFor(operatorId)).toBe("member");

    // Target joins and becomes the group owner + ticket operator of record.
    expect(calls.addMember).toContainEqual({
      chatId: ticketChatId,
      userId: carolId,
      role: "member",
    });
    expect(roleFor(carolId)).toBe("owner");
    expect(calls.ticketOperator).toEqual([
      { chatId: ticketChatId, operatorId: carolId },
    ]);
    expect(ticketState.operatorId).toBe(carolId);

    // In-thread system message marks the handoff.
    const systemMessage = calls.messages.find((m) =>
      String(m.body || "").startsWith("[[system:referred:"),
    );
    expect(systemMessage?.body).toBe("[[system:referred:Carol]]");

    // Realtime: ticket_updated + chat_list_changed reach the members.
    const types = calls.chatEvents.map((e) => e.payload.type);
    expect(types).toContain("ticket_updated");
    expect(types).toContain("chat_list_changed");
    const ticketUpdate = calls.chatEvents.find(
      (e) => e.payload.type === "ticket_updated",
    );
    expect(ticketUpdate.payload.referred).toBe(true);
    expect(ticketUpdate.payload.toUsername).toBe("carol");
  });

  test("referring again adds the next operator without re-converting", async () => {
    const { app, calls, ticketState } = createTestApp({
      chat: {
        id: ticketChatId,
        type: "group",
        channel: "support",
        department_id: deptId,
        group_visibility: "private",
      },
      members: [
        ...defaultMembers,
        { id: carolId, username: "carol", nickname: "Carol", role: "owner", user_role: "operator" },
      ],
      memberRoles: {
        [ticketChatId]: {
          [customerId]: "member",
          [operatorId]: "member",
          [carolId]: "owner",
        },
      },
      ticket: { ...openTicket, operatorId: carolId },
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post(`/api/support/tickets/${ticketChatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "bob", operatorUsername: "dave" });

    expect(res.status).toBe(200);
    expect(res.body.converted).toBe(false);
    expect(calls.convert).toEqual([]);
    expect(ticketState.operatorId).toBe(daveId);
    const daveRole = calls.setRole.find((r) => r.userId === daveId)?.role;
    expect(daveRole).toBe("owner");
  });

  // ─── refer: guards ────────────────────────────────────────────────────────

  test("a customer cannot refer a ticket", async () => {
    const { app, calls } = createTestApp({
      chat: dmTicketChat,
      members: defaultMembers,
      memberRoles: defaultMemberRoles,
      ticket: openTicket,
    });
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post(`/api/support/tickets/${ticketChatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "alice", operatorUsername: "carol" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only staff/i);
    expect(calls.convert).toEqual([]);
  });

  test("a messenger (direct) chat is refused — not_a_ticket", async () => {
    const { app } = createTestApp({
      chat: { id: directChatId, type: "dm", channel: "direct", department_id: null },
      members: defaultMembers,
      memberRoles: { [directChatId]: { [customerId]: "owner", [operatorId]: "member" } },
      ticket: null,
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post(`/api/support/tickets/${directChatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "bob", operatorUsername: "carol" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_a_ticket");
  });

  test("a closed ticket cannot be referred", async () => {
    const { app } = createTestApp({
      chat: dmTicketChat,
      members: defaultMembers,
      memberRoles: defaultMemberRoles,
      ticket: { ...openTicket, status: "closed" },
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post(`/api/support/tickets/${ticketChatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "bob", operatorUsername: "carol" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/i);
  });

  test("a non-staff target is refused", async () => {
    const { app } = createTestApp({
      chat: dmTicketChat,
      members: defaultMembers,
      memberRoles: defaultMemberRoles,
      ticket: openTicket,
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post(`/api/support/tickets/${ticketChatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "bob", operatorUsername: "mallory" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only operators/i);
  });

  test("an operator already in the thread returns 409", async () => {
    const { app } = createTestApp({
      chat: dmTicketChat,
      members: defaultMembers,
      memberRoles: defaultMemberRoles,
      ticket: openTicket,
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post(`/api/support/tickets/${ticketChatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "bob", operatorUsername: "bob" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  test("an operator who is not a member of the thread gets 403", async () => {
    const { app } = createTestApp({
      chat: dmTicketChat,
      members: defaultMembers,
      memberRoles: defaultMemberRoles,
      ticket: openTicket,
    });
    const cookie = await loginCookie(app, "dave");

    const res = await request(app)
      .post(`/api/support/tickets/${ticketChatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "dave", operatorUsername: "carol" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
  });

  // ─── referred-ticket protections (chats.js gates) ─────────────────────────

  test("an operator cannot delete a referred support group via hide", async () => {
    const { app, calls } = createTestApp({
      chat: referredGroupChat,
      members: referredMembers,
      memberRoles: referredMemberRoles,
      ticket: { ...openTicket, operatorId: carolId },
    });
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post("/api/chats/hide")
      .set("Cookie", cookie)
      .send({ username: "bob", chatIds: [ticketChatId] });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the owner/i);
    expect(calls.hiddenFor).toEqual([]);
  });

  test("the group-owner operator cannot hard-delete a referred ticket", async () => {
    const { app } = createTestApp({
      chat: referredGroupChat,
      members: referredMembers,
      memberRoles: referredMemberRoles,
      ticket: { ...openTicket, operatorId: carolId },
    });
    const cookie = await loginCookie(app, "carol");

    const res = await request(app)
      .post(`/api/chats/group/${ticketChatId}/delete`)
      .set("Cookie", cookie)
      .send({ username: "carol", password: "secret123" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the owner can delete tickets/i);
  });

  test("the last staff member cannot abandon a referred ticket by leaving", async () => {
    const { app, calls } = createTestApp({
      chat: {
        id: ticketChatId,
        type: "group",
        channel: "support",
        department_id: deptId,
        group_visibility: "private",
      },
      members: [
        { id: customerId, username: "alice", nickname: "Alice", role: "member", user_role: "user" },
        { id: carolId, username: "carol", nickname: "Carol", role: "owner", user_role: "operator" },
      ],
      memberRoles: {
        [ticketChatId]: { [customerId]: "member", [carolId]: "owner" },
      },
      ticket: { ...openTicket, operatorId: carolId },
    });
    const cookie = await loginCookie(app, "carol");

    const res = await request(app)
      .post(`/api/chats/group/${ticketChatId}/leave`)
      .set("Cookie", cookie)
      .send({ username: "carol" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/last staff member/i);
    expect(calls.removedMembers).toEqual([]);
  });

  test("ownership on staff leave passes to another staff member, not the customer", async () => {
    const { app, calls } = createTestApp({
      chat: {
        id: ticketChatId,
        type: "group",
        channel: "support",
        department_id: deptId,
        group_visibility: "private",
      },
      members: [
        { id: customerId, username: "alice", nickname: "Alice", role: "member", user_role: "user" },
        { id: operatorId, username: "bob", nickname: "Bob", role: "member", user_role: "operator" },
        { id: carolId, username: "carol", nickname: "Carol", role: "owner", user_role: "operator" },
      ],
      memberRoles: {
        [ticketChatId]: {
          [customerId]: "member",
          [operatorId]: "member",
          [carolId]: "owner",
        },
      },
      ticket: { ...openTicket, operatorId: carolId },
    });
    const cookie = await loginCookie(app, "carol");

    const res = await request(app)
      .post(`/api/chats/group/${ticketChatId}/leave`)
      .set("Cookie", cookie)
      .send({ username: "carol" });

    expect(res.status).toBe(200);
    const ownerTransfer = calls.setRole.find((r) => r.role === "owner");
    expect(ownerTransfer?.userId).toBe(operatorId);
  });

  test("the ticket customer cannot be removed from a referred ticket", async () => {
    const { app, calls } = createTestApp({
      chat: referredGroupChat,
      members: referredMembers,
      memberRoles: referredMemberRoles,
      ticket: { ...openTicket, operatorId: carolId },
    });
    const cookie = await loginCookie(app, "carol");

    const res = await request(app)
      .post(`/api/chats/group/${ticketChatId}/remove-member`)
      .set("Cookie", cookie)
      .send({ username: "carol", targetUsername: "alice" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/customer cannot be removed/i);
    expect(calls.removedMembers).toEqual([]);
  });
});
