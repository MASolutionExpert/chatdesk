import { describe, test, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";

// ─────────────────────────────────────────────────────────────────────────────
// Route-level channel separation (migration 044 `chats.channel`).
//
// The two ways a conversation is born MUST never cross-contaminate:
//   * POST /api/chats/dm          ("find user by ID → message them")
//       → MESSENGER flow, scoped to findDmChat({ channel: "direct" })
//   * POST /api/support/request   (department picker → helpdesk ticket)
//       → SUPPORT flow, scoped to findDmChat({ channel: "support", departmentId })
//
// Regression: /api/chats/dm used to call findDmChat WITHOUT a channel filter,
// so a plain direct message between a customer and an operator could land in
// (and resurrect) the pair's support ticket thread.
// ─────────────────────────────────────────────────────────────────────────────

async function loginCookie(app, username = "alice", password = "secret123") {
  const res = await request(app)
    .post("/api/login")
    .send({ username, password });
  return res.headers["set-cookie"];
}

describe("channel separation at the API layer (direct vs support)", () => {
  const aliceId = "11111111-1111-4111-a111-111111111111";
  const bobId = "22222222-2222-4222-b222-222222222222";
  const carolId = "44444444-4444-4444-8444-444444444444";
  const directChatId = "33333333-3333-4333-8333-333333333331";
  const supportChatId = "33333333-3333-4333-8333-333333333332";
  const deptId = 7;

  function createTestApp({ dmLookup, supportLookup } = {}) {
    const calls = { findDmChat: [], createChat: [], markChatDepartment: [] };

    const userStore = makeUserStore([
      {
        id: aliceId,
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
        id: bobId,
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
        role: "user",
        banned: false,
      },
    ]);

    const { app } = makeApp({
      userStore,
      deps: {
        findDmChat: (u1, u2, options = {}) => {
          calls.findDmChat.push({ u1, u2, options });
          if (typeof dmLookup === "function") return dmLookup(u1, u2, options);
          if (options.channel === "direct") return directChatId;
          if (options.channel === "support") return supportChatId;
          return null;
        },
        createChat: (name, type, options = {}) => {
          calls.createChat.push({ name, type, options });
          return supportChatId;
        },
        markChatDepartment: (chatId, departmentId) => {
          calls.markChatDepartment.push({ chatId, departmentId });
          return true;
        },
        getDepartmentById: (id) =>
          Number(id) === deptId
            ? { id: deptId, name: "Billing", description: "", active: 1 }
            : null,
        pickOperatorForDepartment: () => ({
          id: bobId,
          username: "bob",
          nickname: "Bob",
          color: "#10b981",
        }),
      },
    });

    return { app, calls };
  }

  test("POST /api/chats/dm is scoped to the 'direct' channel and reports it", async () => {
    const { app, calls } = createTestApp();
    const cookie = await loginCookie(app);

    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", cookie)
      .send({ from: "alice", to: "carol" });

    expect(res.status).toBe(200);
    // The reuse response is explicit about the channel kind.
    expect(res.body).toEqual({ id: directChatId, channel: "direct" });

    // The lookup MUST be channel-scoped: a support ticket between the pair is
    // never returned here.
    expect(calls.findDmChat).toHaveLength(1);
    expect(calls.findDmChat[0].u1).toBe(aliceId);
    expect(calls.findDmChat[0].u2).toBe(carolId);
    expect(calls.findDmChat[0].options).toEqual({ channel: "direct" });
  });

  test("POST /api/chats/dm creates a fresh 'direct' chat when no direct chat exists", async () => {
    // Even with an existing support thread for the pair, the direct flow
    // creates its own chat instead of converting the ticket.
    const { app, calls } = createTestApp({
      dmLookup: (u1, u2, options) =>
        options.channel === "support" ? supportChatId : null,
    });
    const cookie = await loginCookie(app);

    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", cookie)
      .send({ from: "alice", to: "carol" });

    expect(res.status).toBe(200);
    expect(calls.createChat).toHaveLength(1);
    expect(calls.createChat[0]).toEqual({
      name: null,
      type: "dm",
      options: { channel: "direct" },
    });
  });

  test("POST /api/support/request is scoped to 'support' + department and reports it", async () => {
    const { app, calls } = createTestApp();
    const cookie = await loginCookie(app);

    const res = await request(app)
      .post("/api/support/request")
      .set("Cookie", cookie)
      .send({
        departmentId: deptId,
        message: "I need help with billing",
        creator: "alice",
      });

    expect(res.status).toBe(201);
    expect(res.body.channel).toBe("support");
    expect(res.body.chatId).toBe(supportChatId);

    const lookup = calls.findDmChat[0];
    expect(lookup.u1).toBe(aliceId);
    expect(lookup.u2).toBe(bobId);
    expect(lookup.options).toEqual({
      channel: "support",
      departmentId: deptId,
    });

    // Reuse path: no new chat is created and no department re-tagging happens.
    expect(calls.createChat).toHaveLength(0);
    expect(calls.markChatDepartment).toHaveLength(0);
  });

  test("POST /api/support/request creates a tagged 'support' chat when no matching ticket exists", async () => {
    const { app, calls } = createTestApp({
      supportLookup: () => null,
      dmLookup: (u1, u2, options) =>
        options.channel === "direct" ? directChatId : null,
    });
    const cookie = await loginCookie(app);

    const res = await request(app)
      .post("/api/support/request")
      .set("Cookie", cookie)
      .send({ departmentId: deptId, message: "hello", creator: "alice" });

    expect(res.status).toBe(201);
    expect(res.body.channel).toBe("support");

    expect(calls.createChat).toHaveLength(1);
    expect(calls.createChat[0]).toEqual({
      name: null,
      type: "dm",
      options: { channel: "support" },
    });
    // The fresh chat is tagged with the department (making it a support thread).
    expect(calls.markChatDepartment).toEqual([
      { chatId: supportChatId, departmentId: deptId },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Role boundary: the messenger NEVER crosses the support boundary.
//
//   customer (role 'user') ↔ staff (operator/admin/owner)  →  TICKET ONLY.
//   POST /api/chats/dm must refuse the pair (both directions) and point at
//   the support-request flow. user↔user and staff↔staff stay messenger.
// ─────────────────────────────────────────────────────────────────────────────

describe("dm role boundary: customers reach staff only via tickets", () => {
  const customerId = "11111111-1111-4111-a111-111111111111";
  const customerId2 = "44444444-4444-4444-8444-444444444444";
  const operatorId = "22222222-2222-4222-b222-222222222222";
  const operatorId2 = "55555555-5555-4555-8555-555555555555";

  function createBoundaryApp() {
    const calls = { findDmChat: [], createChat: [] };
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
        id: customerId2,
        username: "carol",
        password_hash: bcrypt.hashSync("secret123", 4),
        nickname: "Carol",
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
        id: operatorId2,
        username: "dan",
        password_hash: bcrypt.hashSync("secret123", 4),
        nickname: "Dan",
        avatar_url: null,
        color: "#10b981",
        status: "online",
        role: "admin",
        banned: false,
      },
    ]);

    const { app } = makeApp({
      userStore,
      deps: {
        findDmChat: (u1, u2, options = {}) => {
          calls.findDmChat.push({ u1, u2, options });
          return null;
        },
        createChat: (name, type, options = {}) => {
          calls.createChat.push({ name, type, options });
          return "33333333-3333-4333-8333-333333333390";
        },
      },
    });
    return { app, calls };
  }

  test("customer → operator DM is refused with the support-only guidance", async () => {
    const { app, calls } = createBoundaryApp();
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", cookie)
      .send({ from: "alice", to: "bob" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("support_only");
    // The messenger flow must not even look up or create a chat.
    expect(calls.findDmChat).toHaveLength(0);
    expect(calls.createChat).toHaveLength(0);
  });

  test("operator → customer DM is refused too (both directions of the boundary)", async () => {
    const { app, calls } = createBoundaryApp();
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", cookie)
      .send({ from: "bob", to: "alice" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("support_only");
    expect(calls.createChat).toHaveLength(0);
  });

  test("customer ↔ customer DM stays a messenger flow", async () => {
    const { app, calls } = createBoundaryApp();
    const cookie = await loginCookie(app, "alice");

    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", cookie)
      .send({ from: "alice", to: "carol" });

    expect(res.status).toBe(200);
    expect(calls.createChat).toHaveLength(1);
    expect(calls.createChat[0].options).toEqual({ channel: "direct" });
  });

  test("staff ↔ staff DM stays a messenger flow", async () => {
    const { app, calls } = createBoundaryApp();
    const cookie = await loginCookie(app, "bob");

    const res = await request(app)
      .post("/api/chats/dm")
      .set("Cookie", cookie)
      .send({ from: "bob", to: "dan" });

    expect(res.status).toBe(200);
    expect(calls.createChat).toHaveLength(1);
    expect(calls.createChat[0].options).toEqual({ channel: "direct" });
  });
});
