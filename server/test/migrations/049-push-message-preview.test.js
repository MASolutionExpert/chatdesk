import { describe, expect, test, afterEach } from "vitest";
import { createRawTestDb, migrations } from "../db/testDbHelper.js";

describe("push_subscriptions.message_preview survival (036 rebuild + 049 restore)", () => {
  let activeDb = null;

  afterEach(() => {
    if (activeDb) {
      try {
        activeDb.close();
      } catch {}
      activeDb = null;
    }
  });

  function hasPreviewColumn(dbInst) {
    const cols = dbInst.migrationContext.getAll(
      "PRAGMA table_info(push_subscriptions)",
    );
    return cols.some((c) => c.name === "message_preview");
  }

  test("migration 036's SQLite rebuild carries message_preview over (fresh installs)", async () => {
    activeDb = await createRawTestDb();
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (const m of sorted) {
      if (m.version >= 1 && m.version <= 36) {
        await m.up(activeDb.migrationContext);
        activeDb.setSchemaVersion(m.version);
      }
    }
    expect(hasPreviewColumn(activeDb)).toBe(true);
  });

  test("migration 049 restores the column on an install whose 036 ran with the old buggy rebuild", async () => {
    activeDb = await createRawTestDb();
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (const m of sorted) {
      if (m.version >= 1 && m.version <= 35) {
        await m.up(activeDb.migrationContext);
        activeDb.setSchemaVersion(m.version);
      }
    }

    // Simulate the OLD 036 bug: rebuild push_subscriptions WITHOUT the
    // message_preview column (exactly what the pre-fix 036 SQLite path did),
    // then mark versions 36..48 as applied.
    const { db, getAll } = activeDb.migrationContext;
    db.run(`
      CREATE TABLE push_subscriptions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT,
        auth TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run(`INSERT OR IGNORE INTO push_subscriptions_new (id, user_id, endpoint, p256dh, auth)
            SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions`);
    db.run("DROP TABLE push_subscriptions");
    db.run("ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions");
    expect(hasPreviewColumn(activeDb)).toBe(false);
    for (const m of sorted) {
      if (m.version >= 37 && m.version <= 48) {
        await m.up(activeDb.migrationContext);
        activeDb.setSchemaVersion(m.version);
      }
    }

    const migration49 = migrations.find((m) => m.version === 49);
    expect(migration49).toBeTruthy();
    await migration49.up(activeDb.migrationContext);

    expect(hasPreviewColumn(activeDb)).toBe(true);

    // The write path that used to crash now works.
    db.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, message_preview)
       VALUES ('user-1', 'https://push.example/endpoint-1', 'k', 'a', 1)`,
    );
    const rows = getAll(
      "SELECT user_id, endpoint, message_preview FROM push_subscriptions",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].message_preview).toBe(1);
  });

  test("migration 049 is idempotent", async () => {
    activeDb = await createRawTestDb();
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    for (const m of sorted) {
      if (m.version >= 1 && m.version <= 48) {
        await m.up(activeDb.migrationContext);
        activeDb.setSchemaVersion(m.version);
      }
    }
    const migration49 = migrations.find((m) => m.version === 49);
    await migration49.up(activeDb.migrationContext);
    // Re-run must not throw (guarded ALTER).
    await Promise.resolve(migration49.up(activeDb.migrationContext));
    expect(hasPreviewColumn(activeDb)).toBe(true);
  });
});
