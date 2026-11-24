import { describe, test, expect, afterEach } from "vitest";
import request from "supertest";
import { makeApp, makeSessionStore, makeUserStore } from "../helpers/makeApp.js";
import { generateUuid } from "../../lib/uuidUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Security hardening round 2 (back-button / claim-form / logout / brute-force):
//
//  1. GET /api/app/info → adminClaimAvailable is TRUE only when a genuine
//     lockout is possible (ADMIN_API_TOKEN configured AND no admin/owner
//     exists). Any other state must NOT advertise the emergency claim form —
//     previously ANY logged-in user visiting /admin saw the token prompt.
//  2. POST /api/logout must also destroy the PARKED owner session
//     (`admin_sid`) — a logout that leaves a live owner session in a side
//     cookie is an unnecessary risk window.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_ENV = "ADMIN_API_TOKEN";
let savedTokenEnv;

function withTokenEnv(value) {
  savedTokenEnv = process.env[TOKEN_ENV];
  if (value === undefined) {
    delete process.env[TOKEN_ENV];
  } else {
    process.env[TOKEN_ENV] = value;
  }
}

afterEach(() => {
  if (savedTokenEnv === undefined) {
    delete process.env[TOKEN_ENV];
  } else {
    process.env[TOKEN_ENV] = savedTokenEnv;
  }
  savedTokenEnv = undefined;
});

// ─── 1. /api/app/info → adminClaimAvailable ───────────────────────────────────

describe("GET /api/app/info → adminClaimAvailable (emergency-claim gate)", () => {
  test("exposes adminClaimAvailable as a boolean field", async () => {
    withTokenEnv(undefined);
    const { app } = makeApp();
    const res = await request(app).get("/api/app/info");
    expect(res.status).toBe(200);
    expect(typeof res.body.adminClaimAvailable).toBe("boolean");
    expect(res.body.adminClaimAvailable).toBe(false);
  });

  test("token configured + admin exists (healthy install) → false", async () => {
    withTokenEnv("secret-token");
    const { app } = makeApp({
      deps: { hasAnyAdminUser: () => true },
    });
    const res = await request(app).get("/api/app/info");
    expect(res.status).toBe(200);
    expect(res.body.adminClaimAvailable).toBe(false);
  });

  test("token configured + NO admin exists (real lockout) → true", async () => {
    withTokenEnv("secret-token");
    const { app } = makeApp({
      deps: { hasAnyAdminUser: () => false },
    });
    const res = await request(app).get("/api/app/info");
    expect(res.status).toBe(200);
    expect(res.body.adminClaimAvailable).toBe(true);
  });

  test("no token configured + no admin → false (nothing to claim with)", async () => {
    withTokenEnv(undefined);
    const { app } = makeApp({
      deps: { hasAnyAdminUser: () => false },
    });
    const res = await request(app).get("/api/app/info");
    expect(res.status).toBe(200);
    expect(res.body.adminClaimAvailable).toBe(false);
  });

  test("hasAnyAdminUser check throws → fails closed (false)", async () => {
    withTokenEnv("secret-token");
    const { app } = makeApp({
      deps: {
        hasAnyAdminUser: () => {
          throw new Error("db offline");
        },
      },
    });
    const res = await request(app).get("/api/app/info");
    expect(res.status).toBe(200);
    expect(res.body.adminClaimAvailable).toBe(false);
  });

  test("hasAnyAdminUser may return a promise (real db shape)", async () => {
    withTokenEnv("secret-token");
    const { app } = makeApp({
      deps: { hasAnyAdminUser: async () => false },
    });
    const res = await request(app).get("/api/app/info");
    expect(res.status).toBe(200);
    expect(res.body.adminClaimAvailable).toBe(true);
  });
});

// ─── 2. /api/logout destroys the parked owner session ─────────────────────────

function makeImpersonationLogoutApp() {
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
    username: "plain",
    nickname: "Plain",
    role: "user",
    banned: false,
    status: "online",
  };

  const sessionStore = makeSessionStore();
  // The parked owner session (admin_sid) and the minted impersonation
  // session (sid) — exactly the browser state while monitoring a user.
  sessionStore.createSession(owner.id, "parked-owner-session");
  sessionStore.createSession(plain.id, "impersonated-session", {
    impersonatedBy: owner.id,
  });

  const { app, sessionStore: store, userStore } = makeApp({
    sessionStore,
    userStore: makeUserStore([owner, plain]),
    deps: {
      isUserAdmin: (userId) => userId === owner.id,
      isUserOwner: (userId) => userId === owner.id,
    },
  });

  return { app, sessionStore: store, owner, plain };
}

describe("POST /api/logout with a parked owner session (impersonation)", () => {
  test("destroys BOTH the impersonation session and the parked owner session", async () => {
    const { app, sessionStore } = makeImpersonationLogoutApp();

    const res = await request(app)
      .post("/api/logout")
      .set("Cookie", "sid=impersonated-session; admin_sid=parked-owner-session");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The working (impersonated) session is gone…
    expect(sessionStore.getSession("impersonated-session")).toBeNull();
    // …and the parked owner session no longer survives the logout.
    expect(sessionStore.getSession("parked-owner-session")).toBeNull();

    // Both cookies are cleared.
    const cookies = Array.isArray(res.headers["set-cookie"])
      ? res.headers["set-cookie"].join("\n")
      : String(res.headers["set-cookie"] || "");
    expect(cookies).toContain("sid=;");
    expect(cookies).toContain("admin_sid=;");
    expect(cookies).toContain("Max-Age=0");
  });

  test("plain logout (no admin_sid) still works and only touches sid", async () => {
    const { app, sessionStore } = makeImpersonationLogoutApp();

    const res = await request(app)
      .post("/api/logout")
      .set("Cookie", "sid=impersonated-session");

    expect(res.status).toBe(200);
    expect(sessionStore.getSession("impersonated-session")).toBeNull();
    // No admin_sid cookie was presented — nothing else to clean up.
    expect(sessionStore.getSession("parked-owner-session")).not.toBeNull();
  });

  test("admin_sid equal to sid is not double-deleted (defensive)", async () => {
    const { app, sessionStore } = makeImpersonationLogoutApp();
    sessionStore.createSession(sessionStore.getSession("parked-owner-session").userId, "same-token");
    sessionStore.deleteSession("parked-owner-session");

    const res = await request(app)
      .post("/api/logout")
      .set("Cookie", "sid=same-token; admin_sid=same-token");

    expect(res.status).toBe(200);
    expect(sessionStore.getSession("same-token")).toBeNull();
  });
});
