import { describe, expect, test, afterEach } from "vitest";
import { createRawTestDb, migrations } from "../db/testDbHelper.js";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 MEDIUM (F2): migration 036 is a multi-statement DESTRUCTIVE
// migration (SQLite table rebuild: CREATE *_new → INSERT → DROP original →
// RENAME) that used to run WITHOUT a transaction.
//
// Failure modes before the fix:
//   - A crash between `DROP TABLE users` and `ALTER TABLE users_new RENAME`
//     left only the users_new copy; on restart the cleanup loop then DROPPED
//     users_new — the only remaining copy of the data.
//   - On Postgres, a failure midway left FK columns TEXT while users.id was
//     still INTEGER and every rerun failed permanently on `text = integer`.
//
// Fixed contract pinned here:
//   1. the whole SQLite rebuild runs in ONE transaction — a failure midway
//      rolls back to the pre-migration state and a retry is possible;
//   2. the idempotency-guarded rerun is a safe no-op;
//   3. a pre-transactional crashed state (original table missing, *_new
//      present) is RESCUED (renamed back) instead of destroyed.
// PG remains integration-tested here only via SQL-generation parity — the PG
// path needs a live server (see report: PG-only residual).
// ─────────────────────────────────────────────────────────────────────────────

describe("Migration 036 — transactional destructive rebuild", () => {
  let activeDb = null;

  afterEach(() => {
    if (activeDb) {
      try {
        activeDb.close();
      } catch {}
      activeDb = null;
    }
  });

  async function setupDbUpTo35() {
    activeDb = await createRawTestDb();
    const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);
    for (const m of sortedMigrations) {
      if (m.version < 36) {
        await m.up(activeDb.migrationContext);
        activeDb.setSchemaVersion(m.version);
      }
    }
    return activeDb;
  }

  function seedUsers(db) {
    db.run("INSERT INTO users (id, username, password_hash) VALUES (1, 'seed-a', 'hash')");
    db.run("INSERT INTO users (id, username, password_hash) VALUES (2, 'seed-b', 'hash')");
  }

  test("a failure midway rolls back — pre-migration state intact, retry possible", async () => {
    const dbInst = await setupDbUpTo35();
    const realCtx = dbInst.migrationContext;
    const { db } = realCtx;
    seedUsers(db);

    // Wrap db.run so the migration blows up in the MIDDLE of the rebuild
    // (right where chat_messages_new would be created — after users_new /
    // chats_new are built, before any original table is dropped).
    const wrappedCtx = {
      ...realCtx,
      db: {
        ...realCtx.db,
        run: (sql, params) => {
          if (
            typeof sql === "string" &&
            sql.includes("CREATE TABLE chat_messages_new")
          ) {
            throw new Error("simulated mid-migration crash");
          }
          return realCtx.db.run(sql, params);
        },
      },
    };

    const m36 = migrations.find((m) => m.version === 36);
    await expect(m36.up(wrappedCtx)).rejects.toThrow(
      /simulated mid-migration crash/,
    );

    // Pre-migration state fully intact: users still INTEGER, rows preserved.
    const info = db.prepare("PRAGMA table_info(users)").all();
    const idCol = info.find((c) => c.name === "id");
    expect(String(idCol.type).toLowerCase()).toBe("integer");

    const users = realCtx.getAll("SELECT id, username FROM users ORDER BY id");
    expect(users.map((u) => u.username)).toEqual(["seed-a", "seed-b"]);

    // No half-built leftovers.
    for (const leftover of ["users_new", "chats_new", "chat_messages_new"]) {
      expect(realCtx.tableExists(leftover)).toBe(false);
    }

    // Retrying with an unmodified context completes the migration.
    await expect(m36.up(realCtx)).resolves.toBeUndefined();
    const after = realCtx.getAll("SELECT id, username FROM users ORDER BY username");
    expect(after.map((u) => u.username)).toEqual(["seed-a", "seed-b"]);
    for (const row of after) {
      expect(String(row.id)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });

  test("guarded rerun on an already-migrated DB is a no-op", async () => {
    const dbInst = await setupDbUpTo35();
    const realCtx = dbInst.migrationContext;
    seedUsers(realCtx.db);

    const m36 = migrations.find((m) => m.version === 36);
    await m36.up(realCtx);
    const first = realCtx.getAll("SELECT id, username FROM users ORDER BY username");

    await expect(m36.up(realCtx)).resolves.toBeUndefined();

    const second = realCtx.getAll("SELECT id, username FROM users ORDER BY username");
    expect(second).toEqual(first);
    // Still exactly one users table — no *_new leftovers.
    expect(realCtx.tableExists("users_new")).toBe(false);
  });

  test("a pre-transactional crashed state (users missing, users_new present) is rescued, not destroyed", async () => {
    const dbInst = await setupDbUpTo35();
    const realCtx = dbInst.migrationContext;
    const { db } = realCtx;

    // Build the crashed state by hand: uuid backfill + a users_new copy with
    // UUID ids, then drop the original users table (the historical crash
    // point was between DROP TABLE users and the RENAME).
    db.run("ALTER TABLE users ADD COLUMN uuid TEXT");
    db.run("ALTER TABLE chats ADD COLUMN uuid TEXT");
    db.run("ALTER TABLE chat_messages ADD COLUMN uuid TEXT");
    seedUsers(db);
    db.run("UPDATE users SET uuid = '11111111-1111-4111-a111-111111111111' WHERE id = 1");
    db.run("UPDATE users SET uuid = '22222222-2222-4222-a222-222222222222' WHERE id = 2");

    db.run(`CREATE TABLE users_new (
      id TEXT NOT NULL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      nickname TEXT, avatar_url TEXT, color TEXT, status TEXT,
      password_hash TEXT NOT NULL, role TEXT DEFAULT 'user',
      verified INTEGER DEFAULT 0, banned INTEGER DEFAULT 0,
      created_at TEXT, last_seen TEXT,
      avatar_storage_driver TEXT DEFAULT 'local',
      avatar_storage_key TEXT, avatar_encryption_type TEXT DEFAULT 'none'
    )`);
    db.run(`INSERT INTO users_new (id, username, password_hash, role)
            SELECT uuid, username, password_hash, COALESCE(role, 'user') FROM users`);

    db.run("PRAGMA foreign_keys = OFF");
    db.run("DROP TABLE users");
    db.run("PRAGMA foreign_keys = ON");

    const m36 = migrations.find((m) => m.version === 36);
    await expect(m36.up(realCtx)).resolves.toBeUndefined();

    // The rescue renamed users_new back to users, and the rebuild completed:
    // both users survive with TEXT UUID ids.
    const users = realCtx
      .getAll("SELECT id, username FROM users ORDER BY username")
      .map((u) => u.username);
    expect(users).toEqual(["seed-a", "seed-b"]);
    const info = db.prepare("PRAGMA table_info(users)").all();
    const idCol = info.find((c) => c.name === "id");
    expect(String(idCol.type).toLowerCase()).toBe("text");
    expect(realCtx.tableExists("users_new")).toBe(false);
  });
});
