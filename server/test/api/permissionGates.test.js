/**
 * Route-level permission gating (1.7.0): the registry replaces the bare
 * role checks. Each test overrides deps.hasPermission to simulate admin
 * overrides and asserts the route honours them (owner always passes via
 * the service-level bypass, mirrored by the test's own isOwner handling).
 */
import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";
import { ALL_PERMISSION_KEYS, getDefaultPermission } from "../../lib/permissions.js";

const password = bcrypt.hashSync("secret123", 4);
const aliceId = "11111111-1111-4111-8111-111111111111";
const chatId = "22222222-2222-4222-8222-222222222222";

function makeUser(role, username = "alice") {
  return {
    id: aliceId,
    username,
    password_hash: password,
    nickname: "Alice",
    avatar_url: null,
    color: "#10b981",
    status: "online",
    role,
    banned: false,
  };
}

function gate(key, allowed) {
  // Overrides only affect the targeted key; everything else behaves per the
  // registry defaults (exactly how the real service composes them).
  return (role, permissionKey) =>
    permissionKey === key
      ? allowed
      : getDefaultPermission(role, permissionKey);
}

async function login(app, username = "alice") {
  const res = await request(app)
    .post("/api/login")
    .send({ username, password: "secret123" });
  return res.headers["set-cookie"];
}

describe("ticket.create gate (POST /api/support/request)", () => {
  const supportDeps = {
    getDepartmentById: () => ({ id: "d1", name: "Billing", active: true }),
    listDepartments: () => [],
    pickOperatorForDepartment: () => ({ id: "op1", username: "op", role: "operator" }),
    findDmChat: () => null,
    createChat: () => chatId,
    addChatMember: () => ({}),
    createMessage: () => "m1",
    markChatDepartment: () => {},
    unhideChat: () => {},
    getTicketByChatId: () => null,
    createTicketRow: () => ({}),
    findChatById: () => ({ id: chatId, type: "dm", channel: "support", department_id: "d1" }),
    getChatMemberRole: () => "member",
    emitChatEvent: () => {},
    emitSseEvent: () => {},
  };

  test("a user WITHOUT ticket.create gets 403 before any department lookup", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: { ...supportDeps, hasPermission: gate("ticket.create", false) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/support/request")
      .set("Cookie", cookie)
      .send({ departmentId: "d1", message: "Help me", creator: "alice" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("a user WITH an admin-granted ticket.create passes the gate", async () => {
    let created = false;
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: {
        ...supportDeps,
        hasPermission: gate("ticket.create", true),
        createTicketRow: () => {
          created = true;
          return {};
        },
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/support/request")
      .set("Cookie", cookie)
      .send({ departmentId: "d1", message: "Help me", creator: "alice" });
    expect([200, 201]).toContain(res.status);
    expect(created).toBe(true);
  });
});

describe("ticket.close gate (POST /api/support/tickets/:chatId/close)", () => {
  const closeDeps = {
    findChatById: () => ({ id: chatId, type: "dm", channel: "support", department_id: "d1" }),
    getChatMemberRole: () => "member",
    getTicketByChatId: () => ({ id: "t1", status: "open" }),
    setTicketStatusByChatId: () => true,
    emitChatEvent: () => {},
    emitSseEvent: () => {},
  };

  test("a user whose ticket.close is disabled gets 403 and the ticket stays open", async () => {
    const setStatus = vi.fn();
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: {
        ...closeDeps,
        setTicketStatusByChatId: setStatus,
        hasPermission: gate("ticket.close", false),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post(`/api/support/tickets/${chatId}/close`)
      .set("Cookie", cookie)
      .send({ creator: "alice" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    expect(setStatus).not.toHaveBeenCalled();
  });

  test("an operator with ticket.close enabled closes the ticket", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("operator")]),
      deps: {
        ...closeDeps,
        hasPermission: gate("ticket.close", true),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post(`/api/support/tickets/${chatId}/close`)
      .set("Cookie", cookie)
      .send({ creator: "alice" });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
  });
});

describe("dm.send gate (POST /api/chats/dm)", () => {
  const dmDeps = {
    findDmChat: () => null,
    createChat: () => chatId,
    addChatMember: () => ({}),
    unhideChat: () => {},
  };

  function dmApp(hasPermission) {
    const bob = { ...makeUser("user", "bob"), id: "b0000000-0000-4000-8000-000000000002" };
    return makeApp({
      userStore: makeUserStore([makeUser("user"), bob]),
      deps: { ...dmDeps, hasPermission },
    });
  }

  test("a user without dm.send cannot open a direct chat", async () => {
    const { app } = dmApp(gate("dm.send", false));
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", cookie)
      .send({ from: "alice", to: "bob" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("a user with dm.send opens the direct chat", async () => {
    const { app } = dmApp(gate("dm.send", true));
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", cookie)
      .send({ from: "alice", to: "bob" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(chatId);
  });
});

describe("group.create / channel.create gate (POST /api/chats/group)", () => {
  const groupDeps = {
    USERNAME_REGEX: /^\w[\w.]+$/,
    findChatByGroupUsername: () => null,
    createChat: () => chatId,
    addChatMember: () => ({}),
    listChatMembers: () => [],
    createMessage: () => "m1",
    emitChatEvent: () => {},
    emitSseEvent: () => {},
  };

  test("a user without group.create cannot create a group", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: { ...groupDeps, hasPermission: gate("group.create", false) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/chats/group")
      .set("Cookie", cookie)
      .send({
        type: "group",
        creator: "alice",
        nickname: "Team",
        username: "team",
        members: [],
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("channel creation is gated by channel.create, not group.create", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: {
        ...groupDeps,
        hasPermission: (role, key) =>
          key === "group.create"
            ? true
            : key === "channel.create"
              ? false
              : getDefaultPermission(role, key),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/chats/group")
      .set("Cookie", cookie)
      .send({
        type: "channel",
        creator: "alice",
        nickname: "News",
        username: "news",
        members: [],
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/channel/i);
  });
});

describe("call.voice / call.video gate (POST /api/calls/start)", () => {
  const callDeps = {
    findChatById: () => ({ id: chatId, type: "dm" }),
    isMember: () => true,
    listCallHistoryForUser: () => [],
    getSetting: (key) => (key === "CALL" || key === "CALL_VIDEO" ? true : null),
  };

  test("a user without call.voice cannot start a call", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: { ...callDeps, hasPermission: gate("call.voice", false) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/calls/start")
      .set("Cookie", cookie)
      .send({ chatId, type: "voice" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    expect(res.body.error).toMatch(/calls?/i);
  });

  test("video calls are gated by call.video specifically", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: {
        ...callDeps,
        hasPermission: (role, key) =>
          key === "call.voice"
            ? true
            : key === "call.video"
              ? false
              : getDefaultPermission(role, key),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/calls/start")
      .set("Cookie", cookie)
      .send({ chatId, type: "video" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/video/i);
  });
});

describe("message delete_any gate (POST /api/messages/delete)", () => {
  const message = {
    id: "44444444-4444-4444-8444-444444444444",
    chat_id: chatId,
    user_id: "99999999-9999-4999-8999-999999999999", // someone else's message
    body: "Original text",
  };
  const deleteDeps = {
    findChatById: () => ({ id: chatId, type: "group" }),
    isMember: () => true,
    findMessageById: (mid) => (mid === message.id ? message : null),
    hideMessageForEveryone: () => true,
    hideMessageForUser: () => true,
    emitChatEvent: () => {},
  };

  test("an operator WITHOUT the override still cannot delete others' messages in groups", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("operator")]),
      deps: { ...deleteDeps, hasPermission: gate("group.message.delete_any", false) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/messages/delete")
      .set("Cookie", cookie)
      .send({ chatId, username: "alice", messageId: message.id, scope: "everyone" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("an operator WITH a granted group.message.delete_any can delete for everyone", async () => {
    const hide = vi.fn();
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("operator")]),
      deps: {
        ...deleteDeps,
        hideMessageForEveryone: hide,
        hasPermission: gate("group.message.delete_any", true),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/messages/delete")
      .set("Cookie", cookie)
      .send({ chatId, username: "alice", messageId: message.id, scope: "everyone" });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("everyone");
    expect(hide).toHaveBeenCalledWith(message.id);
  });

  test("a user granted dm.message.delete_own can remove their OWN dm message (self scope)", async () => {
    const own = { ...message, user_id: aliceId };
    const hide = vi.fn();
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: {
        ...deleteDeps,
        findMessageById: (mid) => (mid === own.id ? own : null),
        hideMessageForUser: hide,
        findChatById: () => ({ id: chatId, type: "dm", channel: "direct" }),
        hasPermission: (role, key) =>
          key === "dm.message.delete_own"
            ? true
            : key === "dm.message.delete_any"
              ? false
              : getDefaultPermission(role, key),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/messages/delete")
      .set("Cookie", cookie)
      .send({ chatId, username: "alice", messageId: own.id, scope: "self" });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("self");
    expect(hide).toHaveBeenCalledWith(own.id, aliceId);
  });

  test("the same user CANNOT delete others' dm messages without delete_any", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: {
        ...deleteDeps,
        findChatById: () => ({ id: chatId, type: "dm", channel: "direct" }),
        hasPermission: (role, key) =>
          key === "dm.message.delete_own"
            ? true
            : key === "dm.message.delete_any"
              ? false
              : getDefaultPermission(role, key),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/messages/delete")
      .set("Cookie", cookie)
      .send({ chatId, username: "alice", messageId: message.id, scope: "self" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });
});

describe("message edit gate (POST /api/messages/edit)", () => {
  const own = {
    id: "44444444-4444-4444-8444-444444444444",
    chat_id: chatId,
    user_id: aliceId,
    body: "Original text",
  };
  const editDeps = {
    findChatById: () => ({ id: chatId, type: "dm", channel: "direct" }),
    isMember: () => true,
    findMessageById: (mid) => (mid === own.id ? own : null),
    editMessage: () => own.id,
    emitChatEvent: () => {},
  };

  test("a user without dm.message.edit cannot edit even their own message", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: { ...editDeps, hasPermission: gate("dm.message.edit", false) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/messages/edit")
      .set("Cookie", cookie)
      .send({ chatId, username: "alice", messageId: own.id, body: "Edited" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("a user WITH a granted dm.message.edit can edit their own message", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: { ...editDeps, hasPermission: gate("dm.message.edit", true) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/messages/edit")
      .set("Cookie", cookie)
      .send({ chatId, username: "alice", messageId: own.id, body: "Edited" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("chat.leave gate (POST /api/chats/group/:chatId/leave)", () => {
  const leaveDeps = {
    findChatById: () => ({ id: chatId, type: "group" }),
    isMember: () => true,
    listChatMembers: () => [
      { id: aliceId, role: "member", username: "alice" },
      { id: "b0000000-0000-4000-8000-000000000002", role: "owner", username: "boss" },
    ],
    removeChatMember: () => true,
    markChatMemberLeft: () => true,
    emitChatEvent: () => {},
    emitSseEvent: () => {},
    createMessage: () => "m1",
    getTicketByChatId: () => null,
  };

  test("a user without chat.leave cannot leave a group", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: { ...leaveDeps, hasPermission: gate("chat.leave", false) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post(`/api/chats/group/${chatId}/leave`)
      .set("Cookie", cookie)
      .send({ username: "alice" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("a user with chat.leave leaves the group", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: { ...leaveDeps, hasPermission: gate("chat.leave", true) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post(`/api/chats/group/${chatId}/leave`)
      .set("Cookie", cookie)
      .send({ username: "alice" });
    expect(res.status).toBe(200);
  });
});

describe("/api/me embeds the permission array", () => {
  test("the owner receives the full registry; the user role the default set", async () => {
    const owner = { ...makeUser("owner", "boss"), id: "b0000000-0000-4000-8000-00000000000b" };
    const plain = makeUser("user");
    const { app } = makeApp({
      userStore: makeUserStore([owner, plain]),
    });
    const ownerCookie = await login(app, "boss");
    const meOwner = await request(app).get("/api/me").set("Cookie", ownerCookie);
    expect(meOwner.status).toBe(200);
    expect(meOwner.body.role).toBe("owner");
    expect(meOwner.body.permissions).toEqual(ALL_PERMISSION_KEYS);

    const userCookie = await login(app, "alice");
    const meUser = await request(app).get("/api/me").set("Cookie", userCookie);
    expect(meUser.status).toBe(200);
    expect(meUser.body.permissions).toContain("dm.send");
    expect(meUser.body.permissions).toContain("group.create");
    expect(meUser.body.permissions).not.toContain("ticket.refer");
    expect(meUser.body.permissions).not.toContain("dm.message.delete_any");
  });
});

// ─── Stage 3 Medium fixes (external review F5/F6) ─────────────────────────────

describe("ticket.refer gate applies to operators too (F5)", () => {
  const referDeps = {
    findChatById: () => ({ id: chatId, type: "dm", channel: "support", department_id: "d1" }),
    listChatMembers: () => [],
    listStaffReferCandidates: () => [],
    listDepartments: () => [],
    isMember: () => true,
    getChatMemberRole: () => "member",
    getTicketByChatId: () => ({ id: "t1", status: "open" }),
    emitChatEvent: () => {},
    emitSseEvent: () => {},
  };

  test("an operator with ticket.refer=false gets 403 on refer-candidates (matrix override respected)", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("operator")]),
      deps: { ...referDeps, hasPermission: gate("ticket.refer", false) },
    });
    const cookie = await login(app);
    const res = await request(app)
      .get(`/api/support/tickets/${chatId}/refer-candidates`)
      .query({ creator: "alice" })
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("an operator with ticket.refer=false gets 403 on POST refer", async () => {
    const convert = vi.fn();
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("operator")]),
      deps: {
        ...referDeps,
        convertSupportChatToGroup: convert,
        hasPermission: gate("ticket.refer", false),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post(`/api/support/tickets/${chatId}/refer`)
      .set("Cookie", cookie)
      .send({ creator: "alice", operatorUsername: "carol" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    expect(convert).not.toHaveBeenCalled();
  });

  test("an operator with ticket.refer enabled (registry default) still passes", async () => {
    const store = makeUserStore([makeUser("operator")]);
    const { app } = makeApp({
      userStore: store,
      deps: {
        ...referDeps,
        findUserByUsername: (username) =>
          username === "carol"
            ? { id: "c1", username: "carol", role: "operator", banned: false }
            : store.findUserByUsername(username),
        listStaffReferCandidates: () => [
          { id: "c1", username: "carol", nickname: "Carol", role: "operator" },
        ],
        listDepartments: () => [{ id: "d1", name: "Billing", active: true }],
        hasPermission: (role, key) =>
          key === "ticket.refer" ? true : getDefaultPermission(role, key),
      },
    });
    const cookie = await login(app);
    const res = await request(app)
      .get(`/api/support/tickets/${chatId}/refer-candidates`)
      .query({ creator: "alice" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.candidates[0]?.username).toBe("carol");
  });
});

describe("permission gates fail closed on service errors (F6)", () => {
  const throwingService = async () => {
    throw new Error("role_permissions table missing");
  };

  const referDeps = {
    findChatById: () => ({ id: chatId, type: "dm", channel: "support", department_id: "d1" }),
    listChatMembers: () => [],
    listStaffReferCandidates: () => [
      { id: "c1", username: "carol", nickname: "Carol", role: "operator" },
    ],
    listDepartments: () => [],
    isMember: () => true,
    getChatMemberRole: () => "member",
    getTicketByChatId: () => ({ id: "t1", status: "open" }),
    emitChatEvent: () => {},
    emitSseEvent: () => {},
  };

  test("ticket.refer: a throwing permission service denies an operator (403, not fail-open)", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("operator")]),
      deps: { ...referDeps, hasPermission: throwingService },
    });
    const cookie = await login(app);
    const res = await request(app)
      .get(`/api/support/tickets/${chatId}/refer-candidates`)
      .query({ creator: "alice" })
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("ticket.refer: the owner keeps working when the permission service throws", async () => {
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("owner", "boss")]),
      deps: { ...referDeps, hasPermission: throwingService },
    });
    const cookie = await login(app, "boss");
    const res = await request(app)
      .get(`/api/support/tickets/${chatId}/refer-candidates`)
      .query({ creator: "boss" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.candidates[0]?.username).toBe("carol");
  });

  test("call.voice: a throwing permission service denies an operator starting a call", async () => {
    const callDeps = {
      findChatById: () => ({ id: chatId, type: "dm" }),
      isMember: () => true,
      listCallHistoryForUser: () => [],
      getSetting: (key) => (key === "CALL" || key === "CALL_VIDEO" ? true : null),
    };
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("operator")]),
      deps: { ...callDeps, hasPermission: throwingService },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/calls/start")
      .set("Cookie", cookie)
      .send({ chatId, type: "voice" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("ticket.create: a throwing permission service denies the ticket request", async () => {
    const supportDeps = {
      getDepartmentById: () => ({ id: "d1", name: "Billing", active: true }),
      listDepartments: () => [],
      findChatById: () => ({ id: chatId, type: "dm", channel: "support", department_id: "d1" }),
      getChatMemberRole: () => "member",
      emitChatEvent: () => {},
      emitSseEvent: () => {},
    };
    const { app } = makeApp({
      userStore: makeUserStore([makeUser("user")]),
      deps: { ...supportDeps, hasPermission: throwingService },
    });
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/support/request")
      .set("Cookie", cookie)
      .send({ departmentId: "d1", message: "Help me", creator: "alice" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });
});
