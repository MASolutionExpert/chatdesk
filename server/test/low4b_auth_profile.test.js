/**
 * Stage 4 (LOW) security-fix tests — Task 4-b, auth + profile items:
 *
 * 1. Non-string JSON bodies (arrays / numbers) must return 400 instead of
 *    crashing on .trim()/.toLowerCase()/bcrypt and surfacing as 500.
 * 2. The owner must not be able to self-delete via POST /api/profile/delete
 *    (owner is permanent, CLI-only) — 403 owner_protected.
 * 5. Login must validate the password BEFORE revealing banned status, so an
 *    unauthenticated caller cannot probe whether a username is banned.
 */
import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "./helpers/makeApp.js";

const PASSWORD = "right-pass-123";
const hash = () => bcrypt.hashSync(PASSWORD, 10);

function makeAuthApp({ users = [], deps = {} } = {}) {
  const userStore = makeUserStore();
  for (const u of users) userStore.users.set(u.username, u);
  return makeApp({ userStore, deps }).app;
}

function makeUser(overrides = {}) {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    username: "alice",
    password_hash: hash(),
    nickname: null,
    avatar_url: null,
    color: "#10b981",
    status: "online",
    role: "user",
    banned: false,
    ...overrides,
  };
}

async function loginSid(app, username, password = PASSWORD) {
  const res = await request(app)
    .post("/api/login")
    .send({ username, password });
  const cookie = (res.headers["set-cookie"] ?? [])
    .map(String)
    .find((c) => c.startsWith("sid="));
  return { res, cookie };
}

// ─── Item 1: non-string JSON inputs → 400 (not 500) ──────────────────────────

describe("LOW 4-b: non-string JSON bodies return 400", () => {
  test("POST /api/register with array username → 400", async () => {
    const app = makeAuthApp();
    const res = await request(app)
      .post("/api/register")
      .send({ username: ["abcd"], password: "secret123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string/i);
  });

  test("POST /api/register with numeric password → 400", async () => {
    const app = makeAuthApp();
    const res = await request(app)
      .post("/api/register")
      .send({ username: "abcd", password: 123456 });
    expect(res.status).toBe(400);
  });

  test("POST /api/register with array nickname → 400", async () => {
    const app = makeAuthApp();
    const res = await request(app)
      .post("/api/register")
      .send({ username: "abcd", password: "secret123", nickname: ["Nick"] });
    expect(res.status).toBe(400);
  });

  test("POST /api/login with numeric username → 400", async () => {
    const app = makeAuthApp();
    const res = await request(app)
      .post("/api/login")
      .send({ username: 12345, password: "secret123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string/i);
  });

  test("POST /api/login with array password → 400", async () => {
    const app = makeAuthApp();
    const res = await request(app)
      .post("/api/login")
      .send({ username: "alice", password: ["secret123"] });
    expect(res.status).toBe(400);
  });

  test("PUT /api/password with array currentPassword → 400", async () => {
    const app = makeAuthApp({ users: [makeUser()] });
    const { cookie } = await loginSid(app, "alice");
    expect(cookie).toBeTruthy();

    const res = await request(app)
      .put("/api/password")
      .set("Cookie", cookie)
      .send({ username: "alice", currentPassword: ["wrong"], newPassword: "new-pass-9" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string/i);
  });

  test("PUT /api/profile with array username → 400", async () => {
    const app = makeAuthApp({ users: [makeUser()] });
    const { cookie } = await loginSid(app, "alice");

    const res = await request(app)
      .put("/api/profile")
      .set("Cookie", cookie)
      .send({ currentUsername: "alice", username: ["abcd"] });
    expect(res.status).toBe(400);
  });

  test("PUT /api/status with array username → 400", async () => {
    const app = makeAuthApp({ users: [makeUser()] });
    const { cookie } = await loginSid(app, "alice");

    const res = await request(app)
      .put("/api/status")
      .set("Cookie", cookie)
      .send({ username: ["alice"], status: "online" });
    expect(res.status).toBe(400);
  });

  test("string inputs still work after the guards (register + login)", async () => {
    const app = makeAuthApp();
    const reg = await request(app)
      .post("/api/register")
      .send({ username: "abcd", password: "secret123" });
    expect(reg.status).toBe(200);

    const login = await request(app)
      .post("/api/login")
      .send({ username: "abcd", password: "secret123" });
    expect(login.status).toBe(200);
  });
});

// ─── Item 5: banned status must not leak before the password check ───────────

describe("LOW 4-b: login validates the password before the banned check", () => {
  test("banned account + WRONG password → 401 invalid credentials (not 403 banned)", async () => {
    const app = makeAuthApp({
      users: [makeUser({ username: "bannedguy", banned: 1 })],
    });
    const res = await request(app)
      .post("/api/login")
      .send({ username: "bannedguy", password: "totally-wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  test("banned account + CORRECT password → 403 banned", async () => {
    const app = makeAuthApp({
      users: [makeUser({ username: "bannedguy", banned: "1" })], // PG BIGINT string
    });
    const res = await request(app)
      .post("/api/login")
      .send({ username: "bannedguy", password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/banned/i);
  });

  test("non-banned account + correct password → 200", async () => {
    const app = makeAuthApp({ users: [makeUser()] });
    const res = await request(app)
      .post("/api/login")
      .send({ username: "alice", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("alice");
  });

  test("unknown username → generic 401 (no banned/exists oracle)", async () => {
    const app = makeAuthApp({ users: [makeUser({ username: "bannedguy", banned: 1 })] });
    const res = await request(app)
      .post("/api/login")
      .send({ username: "bannedguy", password: "totally-wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });
});

// ─── Item 2: owner cannot self-delete via /api/profile/delete ────────────────

describe("LOW 4-b: owner self-delete is refused (owner_protected)", () => {
  test("owner self-delete → 403 owner_protected, no deletion performed", async () => {
    const deleteUserById = vi.fn(async () => ({ storedNames: [] }));
    const app = makeAuthApp({
      users: [makeUser({ username: "root", role: "owner" })],
      deps: { deleteUserById },
    });
    const { cookie } = await loginSid(app, "root");
    expect(cookie).toBeTruthy();

    const res = await request(app)
      .post("/api/profile/delete")
      .set("Cookie", cookie)
      .send({ username: "root", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
    expect(res.body.error).toMatch(/owner account/i);
    expect(deleteUserById).not.toHaveBeenCalled();
  });

  test("owner role check is case-insensitive", async () => {
    const app = makeAuthApp({
      users: [makeUser({ username: "root", role: "OWNER" })],
    });
    const { cookie } = await loginSid(app, "root");
    const res = await request(app)
      .post("/api/profile/delete")
      .set("Cookie", cookie)
      .send({ username: "root", password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("owner_protected");
  });

  test("non-owner self-delete still works as before", async () => {
    const deleteUserById = vi.fn(async () => ({ storedNames: [] }));
    const app = makeAuthApp({
      users: [makeUser()],
      deps: { deleteUserById },
    });
    const { cookie } = await loginSid(app, "alice");

    const res = await request(app)
      .post("/api/profile/delete")
      .set("Cookie", cookie)
      .send({ username: "alice", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(deleteUserById).toHaveBeenCalledTimes(1);
  });

  test("wrong password on delete still → 401 before any role handling", async () => {
    const deleteUserById = vi.fn(async () => ({ storedNames: [] }));
    const app = makeAuthApp({
      users: [makeUser({ username: "root", role: "owner" })],
      deps: { deleteUserById },
    });
    const { cookie } = await loginSid(app, "root");

    const res = await request(app)
      .post("/api/profile/delete")
      .set("Cookie", cookie)
      .send({ username: "root", password: "not-the-password" });

    expect(res.status).toBe(401);
    expect(deleteUserById).not.toHaveBeenCalled();
  });
});
