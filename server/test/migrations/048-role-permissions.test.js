import { describe, expect, test, afterEach } from "vitest";
import knex from "knex";
import { createRawTestDb, migrations } from "../db/testDbHelper.js";
import { createPermissionService } from "../../lib/permissionService.js";
import { ALL_PERMISSION_KEYS } from "../../lib/permissions.js";

describe("Migration 048: role_permissions override table", () => {
  let activeDb = null;

  afterEach(() => {
    if (activeDb) {
      try {
        activeDb.close();
      } catch {}
      activeDb = null;
    }
  });

  async function setupDbUpTo47() {
    activeDb = await createRawTestDb();
    const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);
    for (const m of sortedMigrations) {
      if (m.version < 48) {
        await m.up(activeDb.migrationContext);
        activeDb.setSchemaVersion(m.version);
      }
    }
    return activeDb;
  }

  test("creates the override table + unique index", async () => {
    const dbInst = await setupDbUpTo47();
    const { db, getAll } = dbInst.migrationContext;
    const migration = migrations.find((m) => m.version === 48);
    expect(migration).toBeTruthy();
    migration.up(dbInst.migrationContext);

    const tables = getAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='role_permissions'",
    );
    expect(tables).toHaveLength(1);

    // Unique (role, permission) pair:
    db.run(
      `INSERT INTO role_permissions (role, permission, allowed, updated_at)
       VALUES ('operator', 'ticket.refer', 0, '2025-01-01')`,
    );
    expect(() =>
      db.run(
        `INSERT INTO role_permissions (role, permission, allowed)
         VALUES ('operator', 'ticket.refer', 1)`,
      ),
    ).toThrow();
  });

  test("is idempotent — a second run is a no-op", async () => {
    const dbInst = await setupDbUpTo47();
    const migration = migrations.find((m) => m.version === 48);
    migration.up(dbInst.migrationContext);
    migration.up(dbInst.migrationContext); // re-run
    const rows = dbInst.migrationContext.getAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='role_permissions'",
    );
    expect(rows).toHaveLength(1);
  });
});

describe("permission service (real SQLite via knex)", () => {
  async function makeService() {
    const db = knex({
      client: "better-sqlite3",
      connection: ":memory:",
      useNullAsDefault: true,
    });
    // Mirror of migration 048's schema:
    await db.schema.createTable("role_permissions", (t) => {
      t.increments("id");
      t.text("role").notNullable();
      t.text("permission").notNullable();
      t.integer("allowed").notNullable().defaultTo(1);
      t.text("updated_at");
      t.unique(["role", "permission"]);
    });
    return { db, service: createPermissionService({
      getAll: (builder) => builder,
      run: (builder) => builder,
      knex: db,
    }) };
  }

  test("owner short-circuits to full access without any DB hit", async () => {
    const { service, db } = await makeService();
    for (const key of ALL_PERMISSION_KEYS) {
      expect(await service.isAllowed("owner", key)).toBe(true);
    }
    expect(await service.isAllowed("owner", "future.unknown")).toBe(true);
    expect(await service.getAllowedKeys("owner")).toEqual(ALL_PERMISSION_KEYS);
  });

  test("no overrides → registry defaults", async () => {
    const { service } = await makeService();
    expect(await service.isAllowed("operator", "ticket.refer")).toBe(true);
    expect(await service.isAllowed("user", "ticket.refer")).toBe(false);
    expect(await service.isAllowed("operator", "dm.message.delete_any")).toBe(false);
    const allowed = await service.getAllowedKeys("user");
    expect(allowed).toContain("dm.send");
    expect(allowed).not.toContain("ticket.refer");
    expect(allowed).not.toContain("dm.message.delete_any");
  });

  test("setOverride stores, flips and resets; cache invalidates eagerly", async () => {
    const { service } = await makeService();
    // Grant ticket.refer to the user role:
    expect(await service.setOverride({ role: "user", permission: "ticket.refer", allowed: true })).toBe(true);
    expect(await service.isAllowed("user", "ticket.refer")).toBe(true);
    // Re-set to false:
    expect(await service.setOverride({ role: "user", permission: "ticket.refer", allowed: false })).toBe(false);
    expect(await service.isAllowed("user", "ticket.refer")).toBe(false);
    // Reset (null) → back to the registry default:
    expect(await service.setOverride({ role: "user", permission: "ticket.refer", allowed: null })).toBe(false);
    expect(await service.listOverrides()).toEqual([]);
  });

  test("disabling a default-on permission sticks", async () => {
    const { service } = await makeService();
    expect(await service.setOverride({ role: "user", permission: "dm.send", allowed: false })).toBe(false);
    expect(await service.isAllowed("user", "dm.send")).toBe(false);
    expect(await service.isAllowed("operator", "dm.send")).toBe(true); // per-role isolation
  });

  test("getMatrix exposes default/override/effective per configurable role", async () => {
    const { service } = await makeService();
    await service.setOverride({ role: "operator", permission: "ticket.delete", allowed: true });
    const matrix = await service.getMatrix();
    expect(matrix.roles).toEqual(["operator", "user"]);
    const entry = matrix.permissions.find((p) => p.key === "ticket.delete");
    expect(entry.roles.operator).toEqual({ default: false, override: true, effective: true });
    expect(entry.roles.user).toEqual({ default: false, override: null, effective: false });
  });

  test("setOverride validates role and permission", async () => {
    const { service } = await makeService();
    await expect(
      service.setOverride({ role: "owner", permission: "dm.send", allowed: false }),
    ).rejects.toThrow(/not configurable/);
    await expect(
      service.setOverride({ role: "user", permission: "made.up", allowed: true }),
    ).rejects.toThrow(/Unknown permission/);
  });

  test("unknown permission keys resolve to deny for non-owner roles", async () => {
    const { service } = await makeService();
    expect(await service.isAllowed("user", "future.unknown")).toBe(false);
    expect(await service.isAllowed("operator", "future.unknown")).toBe(false);
  });
});
