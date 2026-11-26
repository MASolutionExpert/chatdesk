import { describe, test, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeApp, makeSessionStore, makeUserStore } from "../helpers/makeApp.js";
import { generateUuid } from "../../lib/uuidUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Owner impersonation ("login as user") — POST /api/admin/users/:id/impersonate
// and POST /api/admin/impersonate/return.
//
// Security contract pinned here:
//  - ONLY the owner may mint an impersonation session (server-side gate).
//  - The owner account itself can never be impersonated.
//  - Banned targets are refused; self-impersonation is refused.
//  - The owner's real session is parked in the HttpOnly `admin_sid` cookie —
//    no password is ever read or touched.
//  - The minted session is stamped with the owner's id (`impersonated_by`);
//    the return endpoint revokes ONLY such a session, never a fresh login.
//  - Every impersonation/return is written to the admin audit log.
// ─────────────────────────────────────────────────────────────────────────────

function makeImpersonationApp() {
  const owner = {
    id: generateUuid(),
    username: "owner",
    nickname: "Owner",
    role: "owner",
    banned: false,
    status: "online",
  };
  const admin = {
    id: generateUuid(),
    username: "moderator",
    nickname: "Moderator",
    role: "admin",
    banned: false,
    status: "online",
  };
  const plain = {
    id: generateUuid(),
    username: "plain",
    nickname: "Plain",
    role: "user",
    banned: false,
    status: "offline",
  };
  const bannedUser = {
    id: generateUuid(),
    username: "banned",
    nickname: "Banned",
    role: "user",
    banned: 1,
    status: "offline",
  };

  const sessionStore = makeSessionStore();
  const userStore = makeUserStore([owner, admin, plain, bannedUser]);
  sessionStore.createSession(owner.id, "owner-session");
  sessionStore.createSession(admin.id, "admin-session");
  sessionStore.createSession(plain.id, "plain-session");

  const { app, deps } = makeApp({
    sessionStore,
    userStore,
    deps: {
      isUserOwner: (userId) => userId === owner.id,
    },
  });

  return { app, sessionStore, userStore, deps, owner, admin, plain, bannedUser };
}

describe("POST /api/admin/users/:id/impersonate", () => {
  let ctx;
  beforeEach(() => {
    ctx = makeImpersonationApp();
  });

  test("owner impersonates a user: mints a stamped session, parks admin_sid, audits", async () => {
    const { app, sessionStore, deps, owner, plain } = ctx;

    const res = await request(app)
      .post(`/api/admin/users/${plain.id}/impersonate`)
      .set("Cookie", "sid=owner-session")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("plain");
    expect(res.body.role).toBe("user");
    expect(res.body.impersonated).toBe(true);
    expect(res.body.id).toBe(plain.id);

    // Two cookies: the working session becomes the target's, the owner's
    // token is parked in admin_sid (HttpOnly, SameSite=Lax).
    const cookies = Array.isArray(res.headers["set-cookie"])
      ? res.headers["set-cookie"]
      : [res.headers["set-cookie"]];
    const sidCookie = cookies.find((c) => c.startsWith("sid="));
    const adminCookie = cookies.find((c) => c.startsWith("admin_sid="));
    expect(sidCookie).toBeTruthy();
    expect(adminCookie).toBeTruthy();
    const targetToken = decodeURIComponent(sidCookie.split(";")[0].slice(4));
    expect(adminCookie).toContain("admin_sid=owner-session");
    expect(adminCookie).toContain("HttpOnly");
    expect(adminCookie).toContain("SameSite=Lax");

    // The minted session exists and carries the owner stamp.
    const minted = sessionStore.sessions.get(targetToken);
    expect(minted).toBeTruthy();
    expect(minted.userId).toBe(plain.id);
    expect(minted.impersonated_by).toBe(owner.id);

    // Audit trail.
    const entry = deps.__auditLogStore.find((e) => e.action === "user.impersonate");
    expect(entry).toBeTruthy();
    expect(entry.actorUserId).toBe(owner.id);
    expect(entry.actorUsername).toBe("owner");
    expect(entry.targetLabel).toBe("@plain");
    expect(entry.details).toContain(plain.id);
  });

  test("non-owner (operator) session is rejected at the panel gate, nothing minted or audited", async () => {
    const { app, sessionStore, deps, plain } = ctx;

    const res = await request(app)
      .post(`/api/admin/users/${plain.id}/impersonate`)
      .set("Cookie", "sid=admin-session")
      .send({});

    // The panel is owner-only (role model, migration 047) — the request is
    // rejected by the panel middleware before the endpoint's own owner_only
    // defense-in-depth guard can fire.
    expect(res.status).toBe(403);
    expect(deps.__auditLogStore.some((e) => e.action === "user.impersonate")).toBe(false);
    // Only the pre-seeded sessions exist — nothing was minted.
    expect(sessionStore.sessions.size).toBe(3);
  });

  test("unauthenticated request is rejected (401)", async () => {
    const { app, plain } = ctx;
    const res = await request(app)
      .post(`/api/admin/users/${plain.id}/impersonate`)
      .send({});
    expect(res.status).toBe(401);
  });

  test("unknown target user → 404", async () => {
    const { app } = ctx;
    const res = await request(app)
      .post(`/api/admin/users/${generateUuid()}/impersonate`)
      .set("Cookie", "sid=owner-session")
      .send({});
    expect(res.status).toBe(404);
  });

  test("non-UUID id parameter → 400 (uuid middleware)", async () => {
    const { app } = ctx;
    const res = await request(app)
      .post("/api/admin/users/not-a-uuid/impersonate")
      .set("Cookie", "sid=owner-session")
      .send({});
    expect(res.status).toBe(400);
  });

  test("the owner account itself cannot be impersonated (403 owner_protected)", async () => {
    // There is exactly one owner, so to exercise this defense-in-depth guard
    // we let an admin session ACT as an owner (isUserOwner override) while
    // targeting the real owner row — different ids, so the self-check passes
    // and the role guard must fire.
    const admin = {
      id: generateUuid(),
      username: "moderator2",
      nickname: "Moderator2",
      role: "admin",
      banned: false,
      status: "online",
    };
    const owner = {
      id: generateUuid(),
      username: "owner",
      nickname: "Owner",
      role: "owner",
      banned: false,
      status: "online",
    };
    const plain = {
      id: generateUuid(),
      username: "plain2",
      nickname: "Plain2",
      role: "user",
      banned: false,
      status: "offline",
    };
    const sessionStore = makeSessionStore();
    const userStore = makeUserStore([admin, owner, plain]);
    sessionStore.createSession(admin.id, "admin-session");
    const { app } = makeApp({
      sessionStore,
      userStore,
      deps: {
        isUserOwner: (userId) => userId === owner.id || userId === admin.id,
      },
    });

    const res = await request(app)
      .post(`/api/admin/users/${owner.id}/impersonate`)
      .set("Cookie", "sid=admin-session")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
  });

  test("self-impersonation is refused (400)", async () => {
    const { app, owner } = ctx;
    const res = await request(app)
      .post(`/api/admin/users/${owner.id}/impersonate`)
      .set("Cookie", "sid=owner-session")
      .send({});
    expect(res.status).toBe(400);
  });

  test("banned target is refused (403)", async () => {
    const { app, bannedUser } = ctx;
    const res = await request(app)
      .post(`/api/admin/users/${bannedUser.id}/impersonate`)
      .set("Cookie", "sid=owner-session")
      .send({});
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/impersonate/return", () => {
  let ctx;
  beforeEach(() => {
    ctx = makeImpersonationApp();
  });

  // Helper: run a real impersonation first and extract the minted token.
  const impersonate = async (target) => {
    const res = await request(ctx.app)
      .post(`/api/admin/users/${target.id}/impersonate`)
      .set("Cookie", "sid=owner-session")
      .send({});
    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"];
    const sidCookie = cookies.find((c) => c.startsWith("sid="));
    return decodeURIComponent(sidCookie.split(";")[0].slice(4));
  };

  test("restores the owner session, revokes the minted session, audits", async () => {
    const { app, sessionStore, deps, owner, plain } = ctx;
    const targetToken = await impersonate(plain);
    expect(sessionStore.sessions.has(targetToken)).toBe(true);

    const res = await request(app)
      .post("/api/admin/impersonate/return")
      .set("Cookie", `sid=${targetToken}; admin_sid=owner-session`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("owner");
    expect(res.body.role).toBe("owner");

    // Working session back to the owner's token; minted session revoked.
    const cookies = res.headers["set-cookie"];
    const sidCookie = cookies.find((c) => c.startsWith("sid="));
    expect(sidCookie.split(";")[0]).toBe("sid=owner-session");
    const adminCookie = cookies.find((c) => c.startsWith("admin_sid="));
    expect(adminCookie).toContain("Max-Age=0");
    expect(sessionStore.sessions.has(targetToken)).toBe(false);
    expect(sessionStore.sessions.has("owner-session")).toBe(true);

    const entry = deps.__auditLogStore.find((e) => e.action === "user.impersonate_return");
    expect(entry).toBeTruthy();
    expect(entry.actorUserId).toBe(owner.id);
    expect(entry.targetLabel).toBe("@plain");
  });

  test("no parked admin_sid cookie → 400 not_impersonating", async () => {
    const { app } = ctx;
    const res = await request(app)
      .post("/api/admin/impersonate/return")
      .set("Cookie", "sid=plain-session")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_impersonating");
  });

  test("expired parked admin session → 401 admin_session_expired", async () => {
    const { app } = ctx;
    const res = await request(app)
      .post("/api/admin/impersonate/return")
      .set("Cookie", "sid=plain-session; admin_sid=deleted-token")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("admin_session_expired");
  });

  test("parked cookie of a non-admin user → 403 admin_required", async () => {
    const { app } = ctx;
    // admin_sid resolves to the PLAIN user's live session — not an admin.
    // (The two tokens must differ, otherwise the not_impersonating guard
    // fires first.)
    const res = await request(app)
      .post("/api/admin/impersonate/return")
      .set("Cookie", "sid=owner-session; admin_sid=plain-session")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("admin_required");
  });

  test("a fresh (non-impersonated) working session is NEVER revoked by a stale parked cookie", async () => {
    const { app, sessionStore } = ctx;
    // admin_sid points at the owner, but the working session is a normal
    // login (impersonated_by === null) — e.g. the user re-logged-in while
    // a stale admin_sid cookie lingered in the browser.
    const res = await request(app)
      .post("/api/admin/impersonate/return")
      .set("Cookie", "sid=plain-session; admin_sid=owner-session")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_impersonating");
    // The innocent session survives.
    expect(sessionStore.sessions.has("plain-session")).toBe(true);
  });
});
