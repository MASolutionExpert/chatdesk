import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Owner-impersonation session stamp — REAL database integration (SQLite).
//
// Migration 046 adds `sessions.impersonated_by`; `createSession` writes the
// optional stamp and `getSession` reads it back (with the impersonating
// owner's username via LEFT JOIN). The API tests mock the session store, so
// this suite pins the real db.js → SQLite path end-to-end: the column exists,
// normal logins read back NULL, and impersonation sessions carry the owner's
// id + username.
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; this suite is SQLite-only.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-impersonation-"));

const {
  createUser,
  createSession,
  getSession,
  deleteSession,
} = await import("../../db.js");

const sync = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

describe("sessions.impersonated_by — real database integration", () => {
  const owner = createUser("imp-owner", "hash", "Owner", null, null, { role: "owner" });
  const plain = createUser("imp-plain", "hash", "Plain", null, null, { role: "user" });
  expect(owner).toBeTruthy();
  expect(plain).toBeTruthy();

  test("migration 046 created the column; a normal login session reads back NULL", async () => {
    const token = "normal-login-token-abcdef0123456789abcdef01";
    await sync(createSession(plain, token));

    const session = await sync(getSession(token));
    expect(session).toBeTruthy();
    expect(session.id).toBe(plain);
    expect(session.username).toBe("imp-plain");
    expect(session.impersonated_by).toBeNull();
    expect(session.impersonated_by_username).toBeNull();

    await sync(deleteSession(token));
  });

  test("an impersonation session stores the owner stamp and hydrates the owner's username", async () => {
    const token = "impersonation-token-abcdef0123456789abcdef01";
    await sync(createSession(plain, token, { impersonatedBy: owner }));

    const session = await sync(getSession(token));
    expect(session).toBeTruthy();
    expect(session.id).toBe(plain);
    expect(session.username).toBe("imp-plain");
    expect(String(session.impersonated_by)).toBe(String(owner));
    expect(session.impersonated_by_username).toBe("imp-owner");

    await sync(deleteSession(token));
  });

  test("the minted session is revoked cleanly by deleteSession", async () => {
    const token = "cleanup-token-abcdef0123456789abcdef0123456";
    await sync(createSession(plain, token, { impersonatedBy: owner }));
    await sync(deleteSession(token));
    const session = await sync(getSession(token));
    expect(session).toBeNull();
  });
});
