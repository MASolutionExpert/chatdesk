import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 MEDIUM (F10): the first-registration owner election was a TOCTOU —
// api/auth.js awaits hasAnyUser() and then calls createUser({role:'owner'});
// two concurrent first signups both saw "no users" and BOTH became owner.
//
// Fixed contract (write layer, db.js):
//   1. boot-time partial UNIQUE index idx_users_single_owner ON users(role)
//      WHERE role='owner' — a database-enforced owner singleton on BOTH
//      SQLite and PostgreSQL (covers fresh AND pre-existing installs);
//   2. createUser() with role 'owner' inserts via a single-statement
//      INSERT ... SELECT ... WHERE NOT EXISTS(owner) and throws a CLEAR error
//      when an owner already exists.
// ─────────────────────────────────────────────────────────────────────────────

process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-owner-singleton-"));

const {
  createUser,
  findUserByUsername,
  getRow,
  run,
} = await import("../../db.js");

describe("owner singleton (first-registration race)", () => {
  test("boot creates the partial UNIQUE index idx_users_single_owner", () => {
    const idx = getRow(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_single_owner'",
    );
    expect(idx?.name).toBe("idx_users_single_owner");
    expect(String(idx?.sql || "")).toContain("WHERE role = 'owner'");
  });

  test("first owner is created; a second owner attempt fails with a clear error", () => {
    const ownerId = createUser("first-owner", "hash", "Owner", null, null, {
      role: "owner",
    });
    expect(ownerId).toBeTruthy();
    expect(findUserByUsername("first-owner").role).toBe("owner");

    let secondError = null;
    try {
      createUser("second-owner", "hash", "Impostor", null, null, {
        role: "owner",
      });
    } catch (err) {
      secondError = err;
    }
    expect(secondError).toBeInstanceOf(Error);
    expect(String(secondError?.message || "")).toMatch(/owner/i);

    // The impostor row was NOT inserted, and exactly one owner exists.
    expect(findUserByUsername("second-owner")).toBeNull();
    const owners = getRow("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'");
    expect(Number(owners.n)).toBe(1);
  });

  test("the partial UNIQUE index backstops even a direct INSERT (bypassing createUser)", () => {
    expect(() =>
      run(
        `INSERT INTO users (id, username, nickname, avatar_url, color, password_hash, role, verified, status, last_seen)
         VALUES ('33333333-3333-4333-a333-333333333333', 'second-owner-raw', NULL, NULL, NULL, 'hash', 'owner', 0, 'online', datetime('now'))`,
      ),
    ).toThrow(/UNIQUE constraint/);

    const owners = getRow("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'");
    expect(Number(owners.n)).toBe(1);
  });

  test("regular user creation is unaffected by the owner guard", () => {
    const userId = createUser("plain-user", "hash", "Plain", null, null, {
      role: "user",
    });
    expect(userId).toBeTruthy();
    expect(findUserByUsername("plain-user").role).toBe("user");

    // Operators can also coexist with the owner.
    const opId = createUser("plain-op", "hash", "Op", null, null, {
      role: "operator",
    });
    expect(opId).toBeTruthy();
  });
});
