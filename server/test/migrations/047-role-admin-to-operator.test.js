import { describe, expect, test, afterEach } from "vitest";
import { createRawTestDb, migrations } from "../db/testDbHelper.js";

describe("Migration 047: retire the 'admin' role → operator", () => {
  let activeDb = null;

  afterEach(() => {
    if (activeDb) {
      try {
        activeDb.close();
      } catch {}
      activeDb = null;
    }
  });

  async function setupDbUpTo46() {
    activeDb = await createRawTestDb();
    const sortedMigrations = [...migrations].sort(
      (a, b) => a.version - b.version,
    );
    for (const m of sortedMigrations) {
      if (m.version < 47) {
        await m.up(activeDb.migrationContext);
        activeDb.setSchemaVersion(m.version);
      }
    }
    return activeDb;
  }

  test("normalizes every 'admin' account to 'operator' (case-insensitive)", async () => {
    const dbInst = await setupDbUpTo46();
    const { db, getAll } = dbInst.migrationContext;

    db.run(
      `INSERT INTO users (id, username, password_hash, role, banned, status, color, created_at)
       VALUES
         ('a0000000-0000-4000-8000-000000000001', 'boss',   'x', 'owner',    0, 'online', '#10b981', '2025-01-01'),
         ('a0000000-0000-4000-8000-000000000002', 'deputy', 'x', 'admin',    0, 'online', '#0ea5e9', '2025-01-01'),
         ('a0000000-0000-4000-8000-000000000003', 'chief',  'x', 'ADMIN',    0, 'online', '#0ea5e9', '2025-01-01'),
         ('a0000000-0000-4000-8000-000000000004', 'staff',  'x', 'operator', 0, 'online', '#0ea5e9', '2025-01-01'),
         ('a0000000-0000-4000-8000-000000000005', 'customer', 'x', 'user',   0, 'online', '#f59e0b', '2025-01-01')`,
    );

    const migration = migrations.find((m) => m.version === 47);
    expect(migration).toBeTruthy();
    migration.up(dbInst.migrationContext);

    const rows = getAll("SELECT username, role FROM users ORDER BY username");
    const byName = Object.fromEntries(rows.map((r) => [r.username, r.role]));
    expect(byName.boss).toBe("owner");
    expect(byName.deputy).toBe("operator");
    expect(byName.chief).toBe("operator"); // case-insensitive
    expect(byName.staff).toBe("operator"); // untouched
    expect(byName.customer).toBe("user"); // untouched
  });

  test("is idempotent — a second run is a no-op", async () => {
    const dbInst = await setupDbUpTo46();
    const { db, getAll } = dbInst.migrationContext;

    db.run(
      `INSERT INTO users (id, username, password_hash, role, banned, status, color, created_at)
       VALUES ('a0000000-0000-4000-8000-000000000002', 'deputy', 'x', 'admin', 0, 'online', '#0ea5e9', '2025-01-01')`,
    );

    const migration = migrations.find((m) => m.version === 47);
    migration.up(dbInst.migrationContext);
    migration.up(dbInst.migrationContext); // re-run

    const rows = getAll("SELECT role FROM users");
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("operator");
  });

  test("a NULL/empty role is left untouched", async () => {
    const dbInst = await setupDbUpTo46();
    const { db, getAll } = dbInst.migrationContext;

    db.run(
      `INSERT INTO users (id, username, password_hash, role, banned, status, color, created_at)
       VALUES
         ('a0000000-0000-4000-8000-000000000001', 'ghost', 'x', NULL, 0, 'online', '#f59e0b', '2025-01-01'),
         ('a0000000-0000-4000-8000-000000000002', 'person', 'x', 'user', 0, 'online', '#f59e0b', '2025-01-01')`,
    );

    const migration = migrations.find((m) => m.version === 47);
    migration.up(dbInst.migrationContext);

    const rows = getAll("SELECT username, role FROM users ORDER BY username");
    expect(rows[0].role).toBeNull();
    expect(rows[1].role).toBe("user");
  });
});
