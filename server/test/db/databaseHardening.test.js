import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// v1.1.0-dev.10 — hardened database layer:
//   * fail-fast Postgres timeouts (no infinite hangs)
//   * per-migration watchdog
//   * db:doctor diagnostics
// ---------------------------------------------------------------------------

describe("Postgres timeout hardening (db/knex.js)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  test("defaults are fail-fast, not infinite", async () => {
    process.env.DB_CLIENT = "postgres";
    const knexModule = await import("../../db/knex.js");
    const timeouts = knexModule.getPostgresTimeouts();

    expect(timeouts.connectionTimeoutMs).toBeLessThanOrEqual(30_000);
    expect(timeouts.acquireTimeoutMs).toBeLessThanOrEqual(30_000);
    expect(timeouts.statementTimeoutMs).toBeLessThanOrEqual(60_000);
    expect(timeouts.idleInTransactionTimeoutMs).toBeLessThanOrEqual(60_000);
    expect(timeouts.connectionTimeoutMs).toBeGreaterThan(0);
  });

  test("env overrides are respected (large databases can raise limits)", async () => {
    process.env.DB_CLIENT = "postgres";
    process.env.DB_CONNECTION_TIMEOUT_MS = "45000";
    process.env.DB_STATEMENT_TIMEOUT_MS = "300000";
    process.env.DB_MIGRATION_TIMEOUT_MS_UNUSED = "junk";
    const knexModule = await import("../../db/knex.js");
    const timeouts = knexModule.getPostgresTimeouts();

    expect(timeouts.connectionTimeoutMs).toBe(45_000);
    expect(timeouts.statementTimeoutMs).toBe(300_000);
  });

  test("knex instance carries connection, pool and statement timeouts", async () => {
    process.env.DB_CLIENT = "postgres";
    process.env.POSTGRES_URL = "postgresql://user:secret@db.example.com:6543/chatdesk";
    const knexModule = await import("../../db/knex.js");
    const instance = knexModule.createKnexInstance();
    try {
      const config = instance.client.config;
      expect(config.acquireConnectionTimeout).toBeGreaterThan(0);
      expect(config.pool.min).toBe(0);
      expect(config.pool.createTimeoutMillis).toBeGreaterThan(0);
      expect(config.connection.connectionTimeoutMillis).toBeGreaterThan(0);
      expect(config.connection.statement_timeout).toBeGreaterThan(0);
      expect(config.connection.idle_in_transaction_session_timeout).toBeGreaterThan(0);
    } finally {
      await instance.destroy();
    }
  });

  test("describePgTarget never leaks the password", async () => {
    process.env.POSTGRES_URL =
      "postgresql://chatdesk:s3cr3t-p4ss@pg.internal.example:5432/chatdesk?sslmode=require";
    const knexModule = await import("../../db/knex.js");
    const target = knexModule.describePgTarget();

    expect(target.host).toBe("pg.internal.example");
    expect(target.port).toBe("5432");
    expect(target.database).toBe("chatdesk");
    expect(target.user).toBe("chatdesk");
    expect(target.ssl).toBe(true);
    expect(JSON.stringify(target)).not.toContain("s3cr3t-p4ss");
  });

  test("describePgTarget supports POSTGRES_* parts", async () => {
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_HOST = "10.0.0.5";
    process.env.POSTGRES_PORT = "5433";
    process.env.POSTGRES_DB = "chatdesk_prod";
    process.env.POSTGRES_USER = "chatdesk";
    const knexModule = await import("../../db/knex.js");
    const target = knexModule.describePgTarget();

    expect(target.mode).toBe("parts");
    expect(target.host).toBe("10.0.0.5");
    expect(target.port).toBe("5433");
    expect(target.database).toBe("chatdesk_prod");
    expect(JSON.stringify(target)).not.toContain("postgres");
    // Default password must never appear in the description.
    expect(JSON.stringify(target)).not.toContain(process.env.POSTGRES_PASSWORD || "\u0000");
  });

  test("POSTGRES_SSL=true is honored in URL mode (self-signed servers)", async () => {
    process.env.DB_CLIENT = "postgres";
    process.env.POSTGRES_URL = "postgresql://chatdesk:secret@db.example.com:5432/chatdesk";
    process.env.POSTGRES_SSL = "true";
    const knexModule = await import("../../db/knex.js");
    const instance = knexModule.createKnexInstance();
    try {
      const connection = instance.client.config.connection;
      expect(connection.ssl).toEqual({ rejectUnauthorized: false });
      expect(knexModule.describePgTarget().ssl).toBe(true);
    } finally {
      await instance.destroy();
    }
  });

  test("explicit sslmode in the URL wins over POSTGRES_SSL=true", async () => {
    process.env.DB_CLIENT = "postgres";
    process.env.POSTGRES_URL = "postgresql://chatdesk:secret@db.example.com:5432/chatdesk?sslmode=verify-full";
    process.env.POSTGRES_SSL = "true";
    const knexModule = await import("../../db/knex.js");
    const instance = knexModule.createKnexInstance();
    try {
      const connection = instance.client.config.connection;
      expect(connection.ssl).toBeUndefined();
    } finally {
      await instance.destroy();
    }
  });

  test("POSTGRES_SSL is not forced in parts mode unless explicitly true", async () => {
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_SSL;
    process.env.DB_CLIENT = "postgres";
    const knexModule = await import("../../db/knex.js");
    const instance = knexModule.createKnexInstance();
    try {
      const connection = instance.client.config.connection;
      expect(connection.ssl).toBe(false);
    } finally {
      await instance.destroy();
    }
  });
});

describe("Migration watchdog (db.js)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("getMigrationTimeoutMs defaults to 120s and honors env", async () => {
    const dbModule = await import("../../db.js");
    expect(dbModule.getMigrationTimeoutMs()).toBe(120_000);

    process.env.DB_MIGRATION_TIMEOUT_MS = "5000";
    expect(dbModule.getMigrationTimeoutMs()).toBe(5_000);
  });

  test("DB_MIGRATION_TIMEOUT_MS=0 disables the watchdog as documented", async () => {
    const dbModule = await import("../../db.js");
    process.env.DB_MIGRATION_TIMEOUT_MS = "0";
    expect(dbModule.getMigrationTimeoutMs()).toBe(0);

    // A blank value must be treated as unset, not as a disabled watchdog.
    process.env.DB_MIGRATION_TIMEOUT_MS = "";
    expect(dbModule.getMigrationTimeoutMs()).toBe(120_000);
  });

  test("withMigrationTimeout returns the original promise when disabled", async () => {
    const dbModule = await import("../../db.js");
    process.env.DB_MIGRATION_TIMEOUT_MS = "0";

    const hung = new Promise(() => {});
    expect(dbModule.withMigrationTimeout("036", hung)).toBe(hung);
  });

  test("withMigrationTimeout aborts a hung migration with a labeled error", async () => {
    const dbModule = await import("../../db.js");
    process.env.DB_MIGRATION_TIMEOUT_MS = "80";

    const hung = new Promise(() => {});
    await expect(
      dbModule.withMigrationTimeout("036", hung),
    ).rejects.toThrow(/Migration 036 did not finish within 80ms/);
  });

  test("withMigrationTimeout passes successful results through", async () => {
    const dbModule = await import("../../db.js");
    process.env.DB_MIGRATION_TIMEOUT_MS = "5000";

    await expect(
      dbModule.withMigrationTimeout("042", Promise.resolve("done")),
    ).resolves.toBe("done");
  });
});

describe("db:doctor diagnostics", () => {
  const originalEnv = { ...process.env };
  let tempDataDir = null;

  beforeEach(() => {
    vi.resetModules();
    // Isolate the bootstrap DB (db.js runs migrations on import) in a temp dir
    // so the doctor tests never touch the repository's data/ directory.
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-doctor-"));
    process.env.DATA_DIR = tempDataDir;
    process.env.DB_CLIENT = "sqlite3";
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    if (tempDataDir) {
      try {
        fs.rmSync(tempDataDir, { recursive: true, force: true });
      } catch {}
      tempDataDir = null;
    }
  });

  test("collectDiagnostics reports a healthy sqlite schema", async () => {
    // Bootstrap the schema EXPLICITLY here (importing db.js runs migrations
    // as a side effect) — the doctor itself must never do this.
    await import("../../db.js");
    const doctorModule = await import("../../scripts/db-doctor.js");
    const report = await doctorModule.collectDiagnostics();

    expect(report.findings.failures).toBe(0);
    expect(report.currentSchemaVersion).toBe(report.latestMigrationVersion);
    expect(report.lines.join("\n")).toContain("All 21 critical tables present.");
    expect(report.lines.join("\n")).toContain("No leftover table-rebuild tables");
    // The doctor is read-only: it must never report migrations as pending
    // after they have already been applied.
    expect(report.lines.join("\n")).not.toContain("migration(s) pending");
  });

  test("collectDiagnostics is read-only — it never runs migrations itself", async () => {
    // Fresh, empty database directory: if the doctor secretly imported db.js
    // it would bootstrap the whole schema. It must instead report the missing
    // tables and leave the database untouched.
    const doctorModule = await import("../../scripts/db-doctor.js");
    const report = await doctorModule.collectDiagnostics();

    expect(report.findings.failures).toBeGreaterThan(0);
    expect(report.lines.join("\n")).toContain("Missing critical tables");
    // The doctor only OPENED the database (opening a fresh SQLite file
    // creates an empty one) — it must not have created any tables in it.
    if (fs.existsSync(path.join(tempDataDir, "chatdesk.db"))) {
      const probe = new Database(path.join(tempDataDir, "chatdesk.db"), { readonly: true });
      try {
        const tables = probe
          .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
          .get();
        expect(tables.n).toBe(0);
      } finally {
        probe.close();
      }
    }
  });

  test("collectDiagnostics survives an unreachable Postgres bootstrap without crashing", async () => {
    process.env.DB_CLIENT = "postgres";
    process.env.POSTGRES_URL = "postgresql://chatdesk:secret@127.0.0.1:1/chatdesk";
    process.env.DB_CONNECTION_TIMEOUT_MS = "500";
    vi.resetModules();

    const doctorModule = await import("../../scripts/db-doctor.js");
    const report = await doctorModule.collectDiagnostics();

    expect(report.findings.failures).toBeGreaterThan(0);
    expect(report.lines.join("\n")).toMatch(/bootstrap FAILED|Connection failed/);
    expect(report.lines.join("\n")).toContain("127.0.0.1:1");
    expect(report.lines.join("\n")).not.toContain("secret");
  });
});
