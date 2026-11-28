// Stage 4 (LOW) security fixes — Task 4-a messaging-side tests:
//   1. POST /api/messages/delete scope=everyone requires membership for
//      non-owners (owner stays exempt).
//   2. GET /api/messages caps `limit` at 200 (was 10000).
//   3. GET /api/channels/:username/messages passes afterIdExclusive to
//      getMessages (pollers must not re-receive the anchor message).
//   7b. POST /api/chats/group/:chatId/join-public rejects ticket threads.

import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "./helpers/makeApp.js";

const ALICE_ID = "a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4";
const CHAT_ID = "c0c0c0c0-d1d1-4e2e-af3f-060606060606";
const MSG_ID = "d0d0d0d0-e1e1-4f2f-b040-171717171717";

function buildUser(role = "user") {
  return {
    id: ALICE_ID,
    username: "alice",
    password_hash: bcrypt.hashSync("secret123", 4),
    nickname: "Alice",
    avatar_url: null,
    color: "#10b981",
    status: "online",
    role,
    banned: false,
  };
}

function makeDeleteApp({ role = "owner", isMember = () => false, hasPermission } = {}) {
  const hideForEveryone = vi.fn();
  const writeAdminAuditLog = vi.fn();
  const { app, userStore } = makeApp({
    userStore: makeUserStore([buildUser(role)]),
    deps: {
      isMember,
      findChatById: () => ({ id: CHAT_ID, type: "group", name: "Test" }),
      findMessageById: () => ({
        id: MSG_ID,
        chat_id: CHAT_ID,
        user_id: "99999999-9999-4999-8999-999999999999",
        body: "target message",
      }),
      hideMessageForEveryone: hideForEveryone,
      writeAdminAuditLog,
      ...(hasPermission ? { hasPermission } : {}),
    },
  });
  return { app, userStore, hideForEveryone, writeAdminAuditLog };
}

async function login(app) {
  const res = await request(app)
    .post("/api/login")
    .send({ username: "alice", password: "secret123" });
  return res.headers["set-cookie"];
}

async function deleteMessage(app, body) {
  return request(app)
    .post("/api/messages/delete")
    .set("Cookie", await login(app))
    .send({ chatId: CHAT_ID, username: "alice", messageId: MSG_ID, ...body });
}

// ─── Item 1: scope=everyone membership guard ──────────────────────────────────

describe("POST /api/messages/delete scope=everyone membership guard (low4a)", () => {
  // Grantee of *.message.delete_any — a moderator-style role. The default
  // registry does NOT grant delete_any, so tests inject a permissive
  // hasPermission to model a role that an owner configured.
  const deleteAnyPermission = () => true;

  test("owner can delete in a chat they are not a member of", async () => {
    const { app } = makeDeleteApp({ role: "owner", isMember: () => false });
    const res = await deleteMessage(app, { scope: "everyone" });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("everyone");
  });

  test("non-owner with delete_any but non-member is rejected with 403", async () => {
    const { app, hideForEveryone } = makeDeleteApp({
      role: "admin",
      isMember: () => false,
      hasPermission: deleteAnyPermission,
    });
    const res = await deleteMessage(app, { scope: "everyone" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
    expect(hideForEveryone).not.toHaveBeenCalled();
  });

  test("non-member without delete_any is rejected with 403 permission_denied", async () => {
    const { app } = makeDeleteApp({ role: "admin", isMember: () => false });
    const res = await deleteMessage(app, { scope: "everyone" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("member with delete_any can delete for everyone", async () => {
    const { app, hideForEveryone } = makeDeleteApp({
      role: "admin",
      isMember: () => true,
      hasPermission: deleteAnyPermission,
    });
    const res = await deleteMessage(app, { scope: "everyone" });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("everyone");
    expect(hideForEveryone).toHaveBeenCalledWith(MSG_ID);
  });
});

// ─── Item 2: GET /api/messages limit cap ──────────────────────────────────────

describe("GET /api/messages limit cap (low4a)", () => {
  function makeLimitApp() {
    const getMessages = vi.fn(() => ({ messages: [], hasMore: false }));
    const { app, userStore } = makeApp({
      userStore: makeUserStore([buildUser("user")]),
      deps: {
        isMember: () => true,
        getMessages,
      },
    });
    return { app, userStore, getMessages };
  }

  test("caps limit=10000 at 200", async () => {
    const { app, getMessages } = makeLimitApp();
    const res = await request(app)
      .get("/api/messages")
      .query({ chatId: CHAT_ID, username: "alice", limit: 10000 })
      .set("Cookie", await login(app));
    expect(res.status).toBe(200);
    expect(getMessages).toHaveBeenCalled();
    const options = getMessages.mock.calls[0][1];
    expect(options.limit).toBe(200);
  });

  test("caps limit=500 at 200", async () => {
    const { app, getMessages } = makeLimitApp();
    await request(app)
      .get("/api/messages")
      .query({ chatId: CHAT_ID, username: "alice", limit: 500 })
      .set("Cookie", await login(app));
    expect(getMessages.mock.calls[0][1].limit).toBe(200);
  });

  test("keeps small limits untouched", async () => {
    const { app, getMessages } = makeLimitApp();
    await request(app)
      .get("/api/messages")
      .query({ chatId: CHAT_ID, username: "alice", limit: 25 })
      .set("Cookie", await login(app));
    expect(getMessages.mock.calls[0][1].limit).toBe(25);
  });
});

// ─── Item 3: public channel route opts into exclusive afterId ─────────────────

describe("GET /api/channels/:username/messages afterIdExclusive (low4a)", () => {
  const CHANNEL_USERNAME = "pubchannel";

  function makeChannelApp() {
    const getMessages = vi.fn(() => ({
      messages: [
        {
          id: "e1e1e1e1-f2f2-4a3a-c4b4-292929292929",
          body: "newer message",
          created_at: "2025-01-01T00:00:02.000Z",
        },
      ],
    }));
    const { app } = makeApp({
      deps: {
        getSetting: (key) => (key === "SIGN_UP" ? true : null),
        findChatByGroupUsername: (username) =>
          String(username).toLowerCase() === CHANNEL_USERNAME
            ? {
                id: CHAT_ID,
                type: "channel",
                group_username: `@${CHANNEL_USERNAME}`,
                group_visibility: "public",
                name: "Public Channel",
              }
            : null,
        findMessageById: (id) => ({
          id,
          chat_id: CHAT_ID,
          created_at: "2025-01-01T00:00:01.000Z",
        }),
        getMessages,
      },
    });
    return { app, getMessages };
  }

  test("passes afterIdExclusive=true to getMessages", async () => {
    const { app, getMessages } = makeChannelApp();
    const res = await request(app)
      .get(`/api/channels/${CHANNEL_USERNAME}/messages`)
      .query({ afterId: MSG_ID, limit: 10 });
    expect(res.status).toBe(200);
    expect(getMessages).toHaveBeenCalled();
    const options = getMessages.mock.calls[0][1];
    expect(options.afterId).toBe(MSG_ID);
    expect(options.afterIdExclusive).toBe(true);
    expect(options.viewerUserId).toBeNull();
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].id).toBe(
      "e1e1e1e1-f2f2-4a3a-c4b4-292929292929",
    );
  });

  test("passes afterIdExclusive=true even without a resolvable anchor", async () => {
    const { app, getMessages } = makeChannelApp();
    await request(app)
      .get(`/api/channels/${CHANNEL_USERNAME}/messages`)
      .query({ afterId: "d0d0d0d0-e1e1-4f2f-b040-171717171717" });
    const options = getMessages.mock.calls[0][1];
    expect(options.afterIdExclusive).toBe(true);
  });
});

// ─── Item 7b: join-public rejects ticket threads ─────────────────────────────

describe("POST /api/chats/group/:chatId/join-public ticket guard (low4a)", () => {
  function makeJoinApp({ ticket = null } = {}) {
    const addChatMember = vi.fn();
    const { app, userStore } = makeApp({
      userStore: makeUserStore([buildUser("user")]),
      deps: {
        findChatById: () => ({
          id: CHAT_ID,
          type: "group",
          group_visibility: "public",
          name: "Support Group",
        }),
        isMember: () => false,
        isGroupMemberRemoved: () => false,
        getTicketByChatId: () => ticket,
        addChatMember,
        createMessage: vi.fn(() => "msg-id"),
      },
    });
    return { app, userStore, addChatMember };
  }

  test("rejects a ticket-backed group with 400", async () => {
    const { app, addChatMember } = makeJoinApp({ ticket: { id: "t1", customerId: "x" } });
    const res = await request(app)
      .post(`/api/chats/group/${CHAT_ID}/join-public`)
      .set("Cookie", await login(app))
      .send({ username: "alice" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ticket/i);
    expect(addChatMember).not.toHaveBeenCalled();
  });

  test("still joins a plain public group", async () => {
    const { app, addChatMember } = makeJoinApp({ ticket: null });
    const res = await request(app)
      .post(`/api/chats/group/${CHAT_ID}/join-public`)
      .set("Cookie", await login(app))
      .send({ username: "alice" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(addChatMember).toHaveBeenCalledWith(CHAT_ID, ALICE_ID, "member");
  });
});
