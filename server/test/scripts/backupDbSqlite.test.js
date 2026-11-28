import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 MEDIUM (F1): SQLite backups used to be a bare copyFileSync of
// chatdesk.db. The database runs in WAL mode, so any rows not yet
// checkpointed into the main file were MISSING (or torn) from the copy — the
// pre-migration backup could be stale exactly when it mattered.
//
// Fixed contract pinned here (backupSqliteFile in scripts/backup-db.js):
//   1. better-sqlite3 online backup (db.backup()) produces a consistent
//      snapshot that INCLUDES un-checkpointed WAL contents;
//   2. fallback = wal_checkpoint(TRUNCATE) + copy.
// ─────────────────────────────────────────────────────────────────────────────

const { backupSqliteFile } = await import("../../scripts/backup-db.js");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openWalDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

test("backup captures rows that live only in the un-checkpointed WAL", async () => {
  const workDir = makeTempDir("chatdesk-backup-src-");
  const sourcePath = path.join(workDir, "chatdesk.db");
  const source = openWalDb(sourcePath);

  source.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");

  // Write WITHOUT closing the handle — the row stays in the -wal file
  // (better-sqlite3 checkpoints on close; keeping the handle open mimics the
  // live-server situation the old copyFileSync missed).
  const insert = source.prepare("INSERT INTO t (name) VALUES (?)");
  insert.run("wal-only-row");

  const mainFileOnly = fs.readFileSync(sourcePath);
  const backupPath = path.join(workDir, "backup-wal-safe.db");

  try {
    const result = await backupSqliteFile(sourcePath, backupPath);
    expect(result).toBe(backupPath);

    const backup = new Database(backupPath, { readonly: true });
    const rows = backup.prepare("SELECT name FROM t").all();
    backup.close();

    // The row existed ONLY in the WAL — the fixed backup must contain it.
    expect(rows).toEqual([{ name: "wal-only-row" }]);
    // Sanity: the bare main file alone did NOT contain it (the old bug).
    const bareCopyPath = path.join(workDir, "bare-copy.db");
    fs.writeFileSync(bareCopyPath, mainFileOnly);
    let bareRows = [];
    try {
      const bare = new Database(bareCopyPath, { readonly: true });
      bareRows = bare.prepare("SELECT name FROM t").all();
      bare.close();
    } catch {
      // A bare main-file copy may even fail to open — also evidence of the bug.
    }
    expect(bareRows).toEqual([]);
  } finally {
    source.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("backupSqliteFile rejects a missing source with a clear error", async () => {
  const workDir = makeTempDir("chatdesk-backup-missing-");
  const backupPath = path.join(workDir, "out.db");
  try {
    // Missing source throws synchronously (guard runs before any async work).
    expect(() =>
      backupSqliteFile(path.join(workDir, "nope.db"), backupPath),
    ).toThrow(/No database found/);
    expect(fs.existsSync(backupPath)).toBe(false);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("backup of a fully checkpointed database is a valid, complete copy", async () => {
  const workDir = makeTempDir("chatdesk-backup-plain-");
  const sourcePath = path.join(workDir, "chatdesk.db");
  const source = openWalDb(sourcePath);

  source.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  source.prepare("INSERT INTO t (name) VALUES (?)").run("plain");
  source.pragma("wal_checkpoint(TRUNCATE)");

  const backupPath = path.join(workDir, "backup-plain.db");
  try {
    await backupSqliteFile(sourcePath, backupPath);
    const backup = new Database(backupPath, { readonly: true });
    const rows = backup.prepare("SELECT name FROM t").all();
    backup.close();
    expect(rows).toEqual([{ name: "plain" }]);

    // integrity_check on the snapshot must be ok.
    const check = new Database(backupPath, { readonly: true });
    const integrity = check.pragma("integrity_check", { simple: true });
    check.close();
    expect(String(integrity).toLowerCase()).toBe("ok");
  } finally {
    source.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
