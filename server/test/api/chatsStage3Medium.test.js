/**
 * Stage 3 (MEDIUM) remediation tests — server/api/chats.js + server/lib/sse.js
 *
 * F2  SSE/WS member cache invalidation on membership mutations
 * F6  /api/chats/:chatId/preview no longer leaks invite_token
 * F8  permission checks fail closed when the permission service throws
 */
import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";
import { createSseHub } from "../../lib/sse.js";

const OWNER_ID = "b0b0b0b0-a1a1-4b2b-9c1d-a1a1a1a1a1a1";
const MEMBER_ID = "b1b1b1b1-a2a2-4b3b-9d2e-b2b2b2b2b2b2";
const GROUP_CHAT_ID = "c0c0c0c0-d1d1-4e2e-af3f-060606060606";

const owner = {
  id: OWNER_ID,
  username: "boss",
  nickname: "Boss",
  role: "owner",
};
const member = {
  id: MEMBER_ID,
  username: "alice",
  nickname: "Alice",
  role: "user",
};

function memberRows() {
  return [
    { id: OWNER_ID, username: "boss", role: "owner", user_role: "owner" },
    { id: MEMBER_ID, username: "alice", role: "member", user_role: "user" },
  ];
}

function chatsDeps(overrides = {}) {
  return {
    findUserByUsername: vi.fn().mockImplementation(async (username) =>
      username === "boss" ? owner : member,
    ),
    findChatById: vi.fn().mockResolvedValue({
      id: GROUP_CHAT_ID,
      type: "group",
      channel: "direct",
      group_visibility: "public",
      allow_member_invites: 0,
      invite_token: "secret-invite-token",
      name: "Group",
    }),
    listChatMembers: vi.fn().mockResolvedValue(memberRows()),
    isMember: vi.fn().mockResolvedValue(true),
    getChatMemberRole: vi.fn().mockResolvedValue("member"),
    getTicketByChatId: vi.fn().mockResolvedValue(null),
    createMessage: vi.fn().mockResolvedValue("m1"),
    emitChatEvent: vi.fn(),
    emitSseEvent: vi.fn(),
    ...overrides,
  };
}

function makeSessionApp(deps) {
  const { app, sessionStore } = makeApp({
    userStore: makeUserStore([owner, member]),
    deps,
  });
  return { app, sessionStore };
}

// ─── F6: preview invite-token policy ─────────────────────────────────────────

describe("F6: /api/chats/:chatId/preview invite_token gating", () => {
  test("the owner still sees the invite token", async () => {
    const { app, sessionStore } = makeSessionApp(chatsDeps());
    sessionStore.createSession(OWNER_ID, "owner-sid");
    const res = await request(app)
      .get(`/api/chats/${GROUP_CHAT_ID}/preview`)
      .query({ username: "boss" })
      .set("Cookie", "sid=owner-sid");
    expect(res.status).toBe(200);
    expect(res.body.inviteToken).toBe("secret-invite-token");
  });

  test("a non-owner member gets an empty token when allowMemberInvites is off", async () => {
    const { app, sessionStore } = makeSessionApp(chatsDeps());
    sessionStore.createSession(MEMBER_ID, "member-sid");
    const res = await request(app)
      .get(`/api/chats/${GROUP_CHAT_ID}/preview`)
      .query({ username: "alice" })
      .set("Cookie", "sid=member-sid");
    expect(res.status).toBe(200);
    expect(res.body.inviteToken).toBe("");
  });

  test("a non-owner member sees the token when allowMemberInvites is on", async () => {
    const { app, sessionStore } = makeSessionApp(
      chatsDeps({
        findChatById: vi.fn().mockResolvedValue({
          id: GROUP_CHAT_ID,
          type: "group",
          channel: "direct",
          group_visibility: "public",
          allow_member_invites: 1,
          invite_token: "secret-invite-token",
          name: "Group",
        }),
      }),
    );
    sessionStore.createSession(MEMBER_ID, "member-sid");
    const res = await request(app)
      .get(`/api/chats/${GROUP_CHAT_ID}/preview`)
      .query({ username: "alice" })
      .set("Cookie", "sid=member-sid");
    expect(res.status).toBe(200);
    expect(res.body.inviteToken).toBe("secret-invite-token");
  });

  test("a public-group visitor (non-member) gets an empty token too", async () => {
    const deps = chatsDeps({
      isMember: vi.fn().mockResolvedValue(false),
    });
    const { app, sessionStore } = makeSessionApp(deps);
    sessionStore.createSession(MEMBER_ID, "member-sid");
    const res = await request(app)
      .get(`/api/chats/${GROUP_CHAT_ID}/preview`)
      .query({ username: "alice" })
      .set("Cookie", "sid=member-sid");
    expect(res.status).toBe(200);
    expect(res.body.isMember).toBe(false);
    expect(res.body.inviteToken).toBe("");
  });
});

// ─── F8: permission checks fail closed ───────────────────────────────────────

describe("F8: chats.js permission gate fails closed on service errors", () => {
  const throwingService = async () => {
    throw new Error("role_permissions table missing");
  };

  test("a throwing permission service denies a member leaving a group (403)", async () => {
    const { app, sessionStore } = makeSessionApp(
      chatsDeps({ hasPermission: throwingService }),
    );
    sessionStore.createSession(MEMBER_ID, "member-sid");
    const res = await request(app)
      .post(`/api/chats/group/${GROUP_CHAT_ID}/leave`)
      .set("Cookie", "sid=member-sid")
      .send({ username: "alice" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });

  test("the owner keeps working when the permission service throws", async () => {
    const { app, sessionStore } = makeSessionApp(
      chatsDeps({ hasPermission: throwingService }),
    );
    sessionStore.createSession(OWNER_ID, "owner-sid");
    const res = await request(app)
      .post(`/api/chats/group/${GROUP_CHAT_ID}/leave`)
      .set("Cookie", "sid=owner-sid")
      .send({ username: "boss" });
    // Owner leaving a 2-member group hands ownership on and leaves OK.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("a throwing permission service denies hiding (deleting) a DM thread", async () => {
    const dmChatId = "c5c5c5c5-d6d6-4e7e-af8f-6a6a6a6a6a6a";
    const deps = chatsDeps({
      hasPermission: throwingService,
      findChatById: vi.fn().mockResolvedValue({
        id: dmChatId,
        type: "dm",
        channel: "direct",
      }),
    });
    const { app, sessionStore } = makeSessionApp(deps);
    sessionStore.createSession(MEMBER_ID, "member-sid");
    const res = await request(app)
      .post("/api/chats/hide")
      .set("Cookie", "sid=member-sid")
      .send({ username: "alice", chatIds: [dmChatId] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
  });
});

// ─── F2: member-cache invalidation on membership mutations ───────────────────

describe("F2: membership mutations invalidate the SSE/WS member cache", () => {
  test("remove-member calls invalidateMembers(chatId)", async () => {
    const invalidateMembers = vi.fn();
    const { app, sessionStore } = makeSessionApp(
      chatsDeps({ invalidateMembers }),
    );
    sessionStore.createSession(OWNER_ID, "owner-sid");
    const res = await request(app)
      .post(`/api/chats/group/${GROUP_CHAT_ID}/remove-member`)
      .set("Cookie", "sid=owner-sid")
      .send({ username: "boss", targetUsername: "alice" });
    expect(res.status).toBe(200);
    expect(invalidateMembers).toHaveBeenCalledWith(GROUP_CHAT_ID);
  });

  test("leave calls invalidateMembers(chatId)", async () => {
    const invalidateMembers = vi.fn();
    const { app, sessionStore } = makeSessionApp(
      chatsDeps({ invalidateMembers }),
    );
    sessionStore.createSession(MEMBER_ID, "member-sid");
    const res = await request(app)
      .post(`/api/chats/group/${GROUP_CHAT_ID}/leave`)
      .set("Cookie", "sid=member-sid")
      .send({ username: "alice" });
    expect(res.status).toBe(200);
    expect(invalidateMembers).toHaveBeenCalledWith(GROUP_CHAT_ID);
  });

  test("delete chat calls invalidateMembers(chatId)", async () => {
    const invalidateMembers = vi.fn();
    const bcrypt = (await import("bcryptjs")).default;
    const passwordHash = await bcrypt.hash("correct-pw", 4);
    const deps = chatsDeps({ invalidateMembers });
    deps.findUserByUsername = vi.fn().mockImplementation(async (username) => ({
      ...(username === "boss" ? owner : member),
      password_hash: passwordHash,
    }));
    const { app, sessionStore } = makeSessionApp(deps);
    sessionStore.createSession(OWNER_ID, "owner-sid");
    const res = await request(app)
      .post(`/api/chats/group/${GROUP_CHAT_ID}/delete`)
      .set("Cookie", "sid=owner-sid")
      .send({ username: "boss", password: "correct-pw" });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(invalidateMembers).toHaveBeenCalledWith(GROUP_CHAT_ID);
  });

  test("join-public calls invalidateMembers(chatId)", async () => {
    const invalidateMembers = vi.fn();
    const { app, sessionStore } = makeSessionApp(
      chatsDeps({
        invalidateMembers,
        isMember: vi.fn().mockResolvedValue(false),
      }),
    );
    sessionStore.createSession(MEMBER_ID, "member-sid");
    const res = await request(app)
      .post(`/api/chats/group/${GROUP_CHAT_ID}/join-public`)
      .set("Cookie", "sid=member-sid")
      .send({ username: "alice" });
    expect(res.status).toBe(200);
    expect(invalidateMembers).toHaveBeenCalledWith(GROUP_CHAT_ID);
  });
});

// ─── F2: sse.js cache contract ───────────────────────────────────────────────

describe("F2: createSseHub exposes invalidateMembers and shares one cache", () => {
  test("invalidateMembers forces the next getCachedMembers to re-read", () => {
    const listChatMembers = vi.fn().mockResolvedValue([
      { id: MEMBER_ID, username: "alice" },
    ]);
    const hub = createSseHub({ listChatMembers });

    return Promise.resolve(hub.getCachedMembers(GROUP_CHAT_ID))
      .then(() => Promise.resolve(hub.getCachedMembers(GROUP_CHAT_ID)))
      .then(() => {
        // Second call served from the cache.
        expect(listChatMembers).toHaveBeenCalledTimes(1);
        hub.invalidateMembers(GROUP_CHAT_ID);
        return Promise.resolve(hub.getCachedMembers(GROUP_CHAT_ID));
      })
      .then(() => {
        expect(listChatMembers).toHaveBeenCalledTimes(2);
      });
  });

  test("the wired emitChatEvent carries invalidateMembers for route deps", () => {
    const hub = createSseHub({ listChatMembers: () => [] });
    expect(typeof hub.invalidateMembers).toBe("function");
    expect(typeof hub.emitChatEvent.invalidateMembers).toBe("function");
    expect(hub.emitChatEvent.invalidateMembers).toBe(hub.invalidateMembers);
  });
});
