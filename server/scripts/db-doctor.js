// db:doctor — database health diagnostics for ChatDesk.
//
// READ-ONLY: this tool never runs migrations and never writes to the
// database. It deliberately does NOT import server/db.js — importing that
// module triggers the full migration bootstrap as a side effect, which would
// mean a "diagnostic" silently mutating the schema (and racing a live
// server). All checks below use the knex connection directly.
//
// Answers the questions that matter when something feels wrong:
//   - Which database engine and target am I actually connected to?
//   - How fast is the connection (connectivity preflight)?
//   - Is the schema complete and at the latest migration version?
//   - Are there signs of an interrupted migration (leftover *_new tables)?
//   - SQLite only: integrity check + WAL file health.
//
// Usage: npm run db:doctor  (goes through scripts/run-data-command.sh so it
// runs as the same user/ownership as the app itself).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CRITICAL_TABLES = [
  "admin_audit_logs",
  "app_settings",
  "chat_left_members",
  "chat_members",
  "chat_message_files",
  "chat_message_reads",
  "chat_messages",
  "chat_mutes",
  "chats",
  "departments",
  "group_removed_members",
  "hidden_chat_messages",
  "hidden_chats",
  "meta",
  "pending_presigned_uploads",
  "push_subscriptions",
  "remote_channel_provider_state",
  "remote_channel_queue",
  "remote_channel_sources",
  "sessions",
  "users",
];

const REBUILD_LEFTOVER_TABLES = [
  "users_new",
  "chats_new",
  "chat_messages_new",
  "chat_members_new",
  "chat_left_members_new",
  "hidden_chat_messages_new",
  "chat_message_reads_new",
  "chat_message_files_new",
  "push_subscriptions_new",
  "remote_channel_sources_new",
  "chat_mutes_new",
  "hidden_chats_new",
  "group_removed_members_new",
  "sessions_new",
];

function line(text = "") {
  console.log(text);
}

function section(title) {
  line();
  line(`── ${title} ${"─".repeat(Math.max(1, 62 - title.length))}`);
}

function ok(text) {
  console.log(`  [ OK ] ${text}`);
}

function warn(text) {
  console.log(`  [WARN] ${text}`);
}

function fail(text) {
  console.log(`  [FAIL] ${text}`);
}

function isPostgresMode() {
  // Mirrors server/db.js isPostgresMode() without importing it (see header).
  const client = (
    process.env.DB_CLIENT ||
    (process.env.POSTGRES_URL || process.env.DATABASE_URL ? "postgres" : "sqlite3")
  ).toLowerCase();
  return client === "postgres" || client === "postgresql" || client === "pg";
}

async function readSchemaVersion(dbKnex, postgres) {
  // Mirrors server/db.js getSchemaVersion() but WITHOUT importing db.js:
  // importing that module would run the full migration bootstrap, which a
  // read-only diagnostic must never do. SQLite stores the version in the
  // PRAGMA user_version header field; Postgres uses the meta table.
  try {
    if (postgres) {
      const res = await dbKnex.raw(
        "SELECT value FROM meta WHERE key = 'user_version'",
      );
      const rows = Array.isArray(res) ? res : res?.rows || [];
      return Number(rows[0]?.value || 0);
    }
    const res = await dbKnex.raw("PRAGMA user_version");
    const rows = Array.isArray(res) ? res : res?.rows || [];
    return Number(rows[0]?.user_version ?? rows[0]?.value ?? 0);
  } catch {
    return 0;
  }
}

export async function collectDiagnostics() {
  const findings = { ok: 0, warnings: 0, failures: 0 };
  const report = { findings, lines: [] };
  const record = (fn, text) => {
    fn(text);
    report.lines.push(text);
    if (fn === ok) findings.ok += 1;
    if (fn === warn) findings.warnings += 1;
    if (fn === fail) findings.failures += 1;
  };

  let knexMod, migrations;
  try {
    knexMod = await import("../db/knex.js");
    const migrationsModule = await import("../migrations/index.js");
    migrations = migrationsModule.migrations;
  } catch (error) {
    // Even a failed import must not crash the doctor — print useful
    // diagnostics instead.
    let target = null;
    let timeouts = null;
    try {
      const fallback = await import("../db/knex.js");
      target = fallback.describePgTarget();
      timeouts = fallback.getPostgresTimeouts();
    } catch {}
    record(
      fail,
      `Database modules FAILED to load: ${String(error?.message || error).split("\n")[0].slice(0, 400)}`,
    );
    if (target) {
      record(
        ok,
        `Configured target: ${target.host}:${target.port}, database '${target.database}', user '${target.user}'` +
          ` (via ${target.mode === "url" ? "POSTGRES_URL/DATABASE_URL" : "POSTGRES_* settings"})`,
      );
    }
    if (timeouts) {
      record(ok, `Fail-fast timeouts: connect=${timeouts.connectionTimeoutMs}ms acquire=${timeouts.acquireTimeoutMs}ms statement=${timeouts.statementTimeoutMs}ms`);
    }
    record(warn, "Run: npm run db:migrate  — it prints the full connectivity error with the fix.");
    report.currentSchemaVersion = null;
    report.latestMigrationVersion = null;
    return report;
  }
  const { dbKnex, describePgTarget, getPostgresTimeouts } = knexMod;

  const postgres = isPostgresMode();
  const target = describePgTarget();
  const timeouts = getPostgresTimeouts();

  section("Engine & Target");
  if (postgres) {
    record(
      ok,
      `PostgreSQL via ${target.mode === "url" ? "POSTGRES_URL/DATABASE_URL" : "POSTGRES_* settings"}: ` +
        `${target.host}:${target.port}, database '${target.database}', user '${target.user}'` +
        (target.ssl ? ", SSL required" : ""),
    );
    record(ok, `Timeouts: connect=${timeouts.connectionTimeoutMs}ms acquire=${timeouts.acquireTimeoutMs}ms statement=${timeouts.statementTimeoutMs}ms`);
  } else {
    record(ok, "SQLite (better-sqlite3, WAL mode)");
  }

  section("Connectivity");
  const startedAt = Date.now();
  try {
    await dbKnex.raw(postgres ? "SELECT 1" : "SELECT 1 AS probe");
    record(ok, `Connected and answered a probe query in ${Date.now() - startedAt}ms.`);
  } catch (error) {
    record(fail, `Connection failed: ${String(error?.code || error?.message || error).slice(0, 300)}`);
    report.currentSchemaVersion = null;
    report.latestMigrationVersion = migrations.length;
    report.dbServerVersion = null;
    return report;
  }

  section("Schema");
  let schemaVersion = null;
  try {
    schemaVersion = await readSchemaVersion(dbKnex, postgres);
    report.currentSchemaVersion = schemaVersion;
    report.latestMigrationVersion = migrations.length;
    if (schemaVersion >= migrations.length) {
      record(ok, `Schema version ${schemaVersion}/${migrations.length} — up to date.`);
    } else {
      record(warn, `Schema version ${schemaVersion}/${migrations.length} — ${migrations.length - schemaVersion} migration(s) pending; they will run on next start or db:migrate.`);
    }
  } catch (error) {
    record(fail, `Could not read schema version: ${String(error?.message || error).slice(0, 300)}`);
  }

  let tableNames = [];
  try {
    if (postgres) {
      const res = await dbKnex.raw(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      tableNames = (Array.isArray(res) ? res : res?.rows || []).map((r) =>
        String(r.table_name || "").toLowerCase(),
      );
    } else {
      const res = await dbKnex.raw("SELECT name FROM sqlite_master WHERE type = 'table'");
      tableNames = (Array.isArray(res) ? res : res?.rows || []).map((r) =>
        String(r.name || "").toLowerCase(),
      );
    }
  } catch (error) {
    record(fail, `Could not list tables: ${String(error?.message || error).slice(0, 300)}`);
  }
  const tableSet = new Set(tableNames);

  const missing = CRITICAL_TABLES.filter((t) => !tableSet.has(t));
  if (missing.length === 0) {
    record(ok, `All ${CRITICAL_TABLES.length} critical tables present.`);
  } else {
    record(fail, `Missing critical tables: ${missing.join(", ")} — run db:migrate (self-heal will recreate them).`);
  }

  const leftovers = REBUILD_LEFTOVER_TABLES.filter((t) => tableSet.has(t));
  if (leftovers.length === 0) {
    record(ok, "No leftover table-rebuild tables (no interrupted migration).");
  } else {
    record(warn, `Leftover rebuild tables found: ${leftovers.join(", ")} — an earlier migration was interrupted; re-run db:migrate so migration 036 can clean them up.`);
  }

  section("Data");
  for (const table of ["users", "chats", "chat_messages"]) {
    if (!tableSet.has(table)) continue;
    try {
      const res = await dbKnex.raw(`SELECT COUNT(*) AS count FROM ${table}`);
      const rows = Array.isArray(res) ? res : res?.rows || [];
      const count = Number(rows[0]?.count ?? rows[0]?.["count()"] ?? 0);
      record(ok, `${table}: ${count} row(s).`);
    } catch (error) {
      record(warn, `Could not count rows in ${table}: ${String(error?.message || error).slice(0, 200)}`);
    }
  }

  if (postgres) {
    try {
      const res = await dbKnex.raw("SHOW server_version");
      const rows = Array.isArray(res) ? res : res?.rows || [];
      report.dbServerVersion = rows[0]?.server_version || null;
      if (report.dbServerVersion) record(ok, `Server version: ${report.dbServerVersion}`);
    } catch {}
    try {
      const res = await dbKnex.raw(
        "SELECT pg_size_pretty(pg_database_size(current_database())) AS size",
      );
      const rows = Array.isArray(res) ? res : res?.rows || [];
      if (rows[0]?.size) record(ok, `Database size: ${rows[0].size}`);
    } catch {}
  } else {
    const dataDir = path.resolve(process.env.DATA_DIR || path.join(serverDir, "..", "data"));
    const dbFile = path.join(dataDir, "chatdesk.db");
    if (fs.existsSync(dbFile)) {
      const sizeMb = (fs.statSync(dbFile).size / (1024 * 1024)).toFixed(2);
      record(ok, `Database file: ${dbFile} (${sizeMb} MB).`);
      const wal = `${dbFile}-wal`;
      if (fs.existsSync(wal)) {
        const walMb = (fs.statSync(wal).size / (1024 * 1024)).toFixed(2);
        if (fs.statSync(wal).size > 64 * 1024 * 1024) {
          record(warn, `WAL file is large (${walMb} MB) — run "Vacuum database" from the maintenance menu while the app is stopped.`);
        } else {
          record(ok, `WAL file: ${walMb} MB.`);
        }
      }
    } else {
      record(warn, `Database file not found at ${dbFile} (fresh install?).`);
    }
    try {
      const integrity = await dbKnex.raw("PRAGMA integrity_check");
      const rows = Array.isArray(integrity) ? integrity : integrity?.rows || [];
      const result = String(rows[0]?.integrity_check || rows[0]?.["integrity_check"] || "?");
      if (result === "ok") {
        record(ok, "PRAGMA integrity_check: ok.");
      } else {
        record(fail, `PRAGMA integrity_check: ${result} — restore from a backup (data/backups).`);
      }
    } catch (error) {
      record(warn, `integrity_check failed: ${String(error?.message || error).slice(0, 200)}`);
    }
  }

  return report;
}

export async function runDoctor() {
  line("ChatDesk database doctor");
  line(`Time: ${new Date().toISOString()}`);

  let report;
  try {
    report = await collectDiagnostics();
  } catch (error) {
    fail(`Doctor crashed: ${String(error?.stack || error?.message || error).slice(0, 800)}`);
    report = { findings: { ok: 0, warnings: 0, failures: 1 } };
  }

  section("Summary");
  const { ok: okCount, warnings, failures } = report.findings;
  line(`  ${okCount} check(s) OK, ${warnings} warning(s), ${failures} failure(s).`);

  if (failures > 0) {
    line();
    line("  Action: fix the [FAIL] items above, then re-run: npm run db:doctor");
    return 1;
  }
  if (warnings > 0) {
    line();
    line("  Action: review the [WARN] items above.");
    return 0;
  }
  line();
  line("  Database looks healthy.");
  return 0;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runDoctor()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
