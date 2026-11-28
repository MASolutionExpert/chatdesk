import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { serverDir, dataDir } from "./_cli.js";
import { readDbConfig } from "../settings/env.js";
import { createPostgresMaintenance } from "../lib/postgresMaintenance.js";
import Database from "better-sqlite3";

const projectRootDir = path.resolve(serverDir, "..");
dotenv.config({ path: path.join(projectRootDir, ".env"), quiet: true });
dotenv.config({ path: path.join(serverDir, ".env"), override: true, quiet: true });

const dbPath = path.join(dataDir, "chatdesk.db");
const backupDir = path.join(dataDir, "backups");

// Fallback: fold the WAL back into the main file, then copy. Used only when
// the better-sqlite3 online backup API is unavailable or fails.
function checkpointAndCopy(sourcePath, backupPath) {
  let handle = null;
  try {
    handle = new Database(sourcePath);
    handle.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // If even the checkpoint handle cannot be opened, fall back to the
    // historical bare copy rather than refusing to back up at all.
  }
  if (handle) {
    try {
      handle.close();
    } catch {}
  }
  fs.copyFileSync(sourcePath, backupPath);
  return backupPath;
}

/**
 * Consistent SQLite backup. The database runs in WAL mode: a bare
 * copyFileSync of chatdesk.db alone misses un-checkpointed -wal contents, so
 * the copy could be stale or torn exactly when the backup matters most.
 *
 * Preference order:
 *   1. better-sqlite3 native online backup (`db.backup()`) — a consistent
 *      snapshot of the full database (main file + WAL) taken while the server
 *      keeps running;
 *   2. wal_checkpoint(TRUNCATE) + copy.
 */
export function backupSqliteFile(sourcePath, backupPath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`No database found at ${sourcePath}.`);
  }

  let handle = null;
  try {
    handle = new Database(sourcePath);
    return handle
      .backup(backupPath)
      .then(() => {
        try {
          handle.close();
        } catch {}
        return backupPath;
      })
      .catch((err) => {
        try {
          handle.close();
        } catch {}
        console.warn(
          `Online backup failed (${err?.message || err}); falling back to wal_checkpoint(TRUNCATE)+copy.`,
        );
        return checkpointAndCopy(sourcePath, backupPath);
      });
  } catch (err) {
    if (handle) {
      try {
        handle.close();
      } catch {}
    }
    console.warn(
      `Could not open the database with better-sqlite3 (${err?.message || err}); falling back to wal_checkpoint(TRUNCATE)+copy.`,
    );
    return Promise.resolve(checkpointAndCopy(sourcePath, backupPath));
  }
}

async function main() {
  const dbConfig = readDbConfig();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (dbConfig.client === "postgres") {
    const backupPath = path.join(backupDir, `chatdesk-backup-${stamp}.dump`);
    await createPostgresMaintenance({ config: dbConfig }).backup(backupPath);
    console.log(`PostgreSQL backup created: ${backupPath}`);
    return;
  }

  const backupPath = path.join(backupDir, `chatdesk-backup-${stamp}.db`);
  try {
    await backupSqliteFile(dbPath, backupPath);
  } catch (error) {
    console.error(`Backup failed: ${error?.message || error}`);
    process.exit(1);
  }

  console.log(`Backup created: ${backupPath}`);
}

// Run the CLI flow only when executed directly (node scripts/backup-db.js).
// Importing the module (e.g. from tests) must stay side-effect-free so
// backupSqliteFile is unit-testable.
const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  await main();
}
