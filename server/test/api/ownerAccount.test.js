import { describe, test, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";

/**
 * The system-owner account contract:
 *
 * 1. FIRST-SETUP RULE — the very first user registered on a fresh install
 *    becomes the permanent system owner (role 'owner'). Everyone else is a
 *    normal user.
 * 2. OWNER IMMUTABILITY — no actor through the app (admin, operator, user,
 *    AND the owner themselves via the admin panel) can edit, ban, re-role,
 *    password-reset or delete the owner account. The only supported path for
 *    changing the owner account is the server's interactive menu (CLI).
 * 3. WHAT'S NEW IS OWNER-ONLY — the per-version changelog payload and the
 *    popup/settings entry are served exclusively to the owner session.
 */

const OWNER_ID = "11111111-1111-4111-a111-111111111111";
const ADMIN_ID = "22222222-2222-4222-a222-222222222222";
const USER_ID = "33333333-3333-4333-a333-333333333333";

const makeUsers = () => [
  {
    id: OWNER_ID,
    username: "systemowner",
    nickname: "System Owner",
    password_hash: bcrypt.hashSync("ownerpass", 6),
    role: "owner",
    banned: false,
    status: "online",
    color: "#10b981",
    verified: 1,
  },
  {
    id: ADMIN_ID,
    username: "deputy",
    nickname: "Deputy Admin",
    password_hash: bcrypt.hashSync("adminpass", 6),
    role: "admin",
    banned: false,
    status: "online",
    color: "#0ea5e9",
    verified: 0,
  },
  {
    id: USER_ID,
    username: "plainuser",
    nickname: "Plain User",
    password_hash: bcrypt.hashSync("userpass", 6),
    role: "user",
    banned: false,
    status: "online",
    color: "#f59e0b",
    verified: 0,
  },
];

function makeOwnerApp({ users = makeUsers() } = {}) {
  const harness = makeApp({
    userStore: makeUserStore(users),
    deps: {
      isUserAdmin: (id) => {
        const u = harness?.userStore?.findUserById?.(id) ?? findUser(id);
        return u?.role === "admin" || u?.role === "owner";
      },
      isUserOwner: (id) => (findUser(id)?.role === "owner"),
      getOwnerUser: () => findUserByRole("owner") || null,
    },
  });
  function findUser(id) {
    return [...harness.userStore.users.values()].find((u) => u.id === id) || null;
  }
  function findUserByRole(role) {
    return [...harness.userStore.users.values()].find((u) => u.role === role) || null;
  }
  return harness;
}

function sessionCookie(harness, userId) {
  const token = `tok-${userId}`;
  harness.sessionStore.createSession(userId, token);
  return `sid=${token}`;
}

const META_FS = {
  existsSync: () => true,
  readFileSync: (p) => {
    const s = String(p);
    if (s.endsWith("/VERSION")) return "1.4.0-dev.2\n";
    if (s.endsWith("/CHANGELOG.md")) {
      return "# Changelog\n\n## 1.4.0-dev.2\n\n### Added\n\n- Owner lockdown and owner-only what's new.\n";
    }
    if (s.endsWith("/package.json")) {
      return JSON.stringify({
        repository: { url: "https://github.com/MASolutionExpert/chatdesk" },
      });
    }
    return "";
  },
};

// ─── 1. First-setup ownership ──────────────────────────────────────────────────

describe("first-setup ownership rule", () => {
  test("the FIRST registered user becomes the system owner", async () => {
    const { app } = makeApp(); // empty user store → fresh install
    const res = await request(app)
      .post("/api/register")
      .send({ username: "founder", password: "secret123", nickname: "Founder" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("owner");

    const me = await request(app).get("/api/me").set("Cookie", res.headers["set-cookie"]);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("owner");
  });

  test("every LATER registration is a normal user", async () => {
    const { app } = makeApp();
    await request(app)
      .post("/api/register")
      .send({ username: "founder", password: "secret123" });
    const second = await request(app)
      .post("/api/register")
      .send({ username: "second", password: "secret123" });
    expect(second.status).toBe(200);
    expect(second.body.role).toBe("user");
  });

  test("login reports the owner role", async () => {
    const { app } = makeApp();
    await request(app)
      .post("/api/register")
      .send({ username: "founder", password: "secret123" });
    const res = await request(app)
      .post("/api/login")
      .send({ username: "founder", password: "secret123" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("owner");
  });
});

// ─── 2. Owner immutability ─────────────────────────────────────────────────────

describe("owner account immutability via the admin API", () => {
  test("admin cannot EDIT the owner account", async () => {
    const harness = makeOwnerApp();
    const res = await request(harness.app)
      .patch(`/api/admin/users/${OWNER_ID}`)
      .set("Cookie", sessionCookie(harness, ADMIN_ID))
      .send({ nickname: "Hacked" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
  });

  test("owner cannot EDIT their own account via the admin panel either", async () => {
    const harness = makeOwnerApp();
    const res = await request(harness.app)
      .patch(`/api/admin/users/${OWNER_ID}`)
      .set("Cookie", sessionCookie(harness, OWNER_ID))
      .send({ nickname: "Self edit" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
  });

  test("admin cannot BAN the owner", async () => {
    const harness = makeOwnerApp();
    const res = await request(harness.app)
      .post(`/api/admin/users/${OWNER_ID}/ban`)
      .set("Cookie", sessionCookie(harness, ADMIN_ID))
      .send({ banned: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
  });

  test("owner cannot be DEMOTED via the role endpoint (by anyone)", async () => {
    const harness = makeOwnerApp();
    const res = await request(harness.app)
      .post(`/api/admin/users/${OWNER_ID}/role`)
      .set("Cookie", sessionCookie(harness, OWNER_ID))
      .send({ role: "admin" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
  });

  test("admin cannot RESET the owner's password", async () => {
    const harness = makeOwnerApp();
    const res = await request(harness.app)
      .post(`/api/admin/users/${OWNER_ID}/reset-password`)
      .set("Cookie", sessionCookie(harness, ADMIN_ID))
      .send({ password: "newpass123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
  });

  test("admin cannot DELETE the owner", async () => {
    const harness = makeOwnerApp();
    const res = await request(harness.app)
      .delete(`/api/admin/users/${OWNER_ID}`)
      .set("Cookie", sessionCookie(harness, ADMIN_ID));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
  });

  test("a SECOND owner cannot be promoted while one exists (409)", async () => {
    const harness = makeOwnerApp();
    const res = await request(harness.app)
      .post(`/api/admin/users/${ADMIN_ID}/role`)
      .set("Cookie", sessionCookie(harness, OWNER_ID))
      .send({ role: "owner" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("owner_protected");
  });

  test("owner and admin sessions pass the admin middleware (proven by route-level guards)", async () => {
    const harness = makeOwnerApp();
    // Reaching the route's own owner_protected guard (403, not 401 "Not
    // authenticated" nor 403 "Admin access required") proves the actor
    // cleared the admin middleware.
    const asAdmin = await request(harness.app)
      .post(`/api/admin/users/${OWNER_ID}/ban`)
      .set("Cookie", sessionCookie(harness, ADMIN_ID))
      .send({ banned: true });
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.code).toBe("owner_protected");
    const asOwner = await request(harness.app)
      .post(`/api/admin/users/${OWNER_ID}/ban`)
      .set("Cookie", sessionCookie(harness, OWNER_ID))
      .send({ banned: true });
    expect(asOwner.status).toBe(403);
    expect(asOwner.body.code).toBe("owner_protected");
    // And a plain user is stopped by the middleware itself.
    const asUser = await request(harness.app)
      .post(`/api/admin/users/${OWNER_ID}/ban`)
      .set("Cookie", sessionCookie(harness, USER_ID))
      .send({ banned: true });
    expect(asUser.status).toBe(403);
    expect(asUser.body.error).toBe("Admin access required");
  });
});

// ─── 3. What's new is owner-only ───────────────────────────────────────────────

describe("GET /api/app/whats-new (owner-only changelog)", () => {
  test("anonymous → 401", async () => {
    const { app } = makeApp({ deps: { fs: META_FS } });
    const res = await request(app).get("/api/app/whats-new");
    expect(res.status).toBe(401);
  });

  test("plain user → 403 owner_only", async () => {
    const harness = makeApp({
      userStore: makeUserStore(makeUsers()),
      deps: { fs: META_FS, isUserOwner: (id) => id === OWNER_ID },
    });
    const res = await request(harness.app)
      .get("/api/app/whats-new")
      .set("Cookie", sessionCookie(harness, USER_ID));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_only");
  });

  test("admin → 403 owner_only (not even admins see the changelog)", async () => {
    const harness = makeApp({
      userStore: makeUserStore(makeUsers()),
      deps: { fs: META_FS, isUserOwner: (id) => id === OWNER_ID },
    });
    const res = await request(harness.app)
      .get("/api/app/whats-new")
      .set("Cookie", sessionCookie(harness, ADMIN_ID));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_only");
  });

  test("owner → 200 with the full what\'s-new payload", async () => {
    const harness = makeApp({
      userStore: makeUserStore(makeUsers()),
      deps: { fs: META_FS, isUserOwner: (id) => id === OWNER_ID },
    });
    const res = await request(harness.app)
      .get("/api/app/whats-new")
      .set("Cookie", sessionCookie(harness, OWNER_ID));
    expect(res.status).toBe(200);
    expect(res.body.version).toBe("1.4.0-dev.2");
    expect(res.body.channel).toBe("dev");
    expect(res.body.changelogSections).toHaveLength(1);
    expect(res.body.currentChangelog).toContain("Owner lockdown");
  });

  test("public /api/app/info no longer leaks the changelog", async () => {
    const { app } = makeApp({ deps: { fs: META_FS } });
    const res = await request(app).get("/api/app/info");
    expect(res.status).toBe(200);
    expect(res.body.version).toBe("1.4.0-dev.2");
    expect(res.body.changelog).toBeUndefined();
    expect(res.body.changelogSections).toBeUndefined();
    expect(res.body.currentChangelog).toBeUndefined();
  });
});
