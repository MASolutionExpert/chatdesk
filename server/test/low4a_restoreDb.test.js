// Stage 4 (LOW) security fixes — Task 4-a restore-db test:
//   8. The SQLite restore path must refuse to touch the live database file
//      while a ChatDesk server is answering on the configured port (same
//      guard the PostgreSQL branch already had).
//
// Implementation note: the "server is running" case is simulated by a small
// preload module that patches global.fetch inside the child process to
// answer GET /api/health with 200 (deterministic, no real networking). The
// real detectRunningServer() code path (fetch → res.ok → { running: true })
// is exercised unchanged; sandboxed CI environments may not allow loopback
// HTTP between processes, so a real socket server is not used here.

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const scriptsDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../scripts",
);
const serverDir = path.resolve(scriptsDir, "..");
const restoreScriptPath = path.join(scriptsDir, "restore-db.js");

// Preload injected into the child: any fetch is answered like a live
// ChatDesk health endpoint. Set PORT to a fixed unused port so the script's
// detectRunningServer() targets a stable, documented port.
const PRELOAD_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-restore-preload-")),
  "fake-health.cjs",
);
fs.writeFileSync(
  PRELOAD_PATH,
  `
process.env.__FAKE_CHATDESK_HEALTH__ = "1";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (u.includes("/api/health")) {
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  return realFetch(url, options);
};
`,
);

function runRestore(env) {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(
      process.execPath,
      [restoreScriptPath, "-y", "--file", env.__backupFile],
      {
        encoding: "utf8",
        cwd: serverDir,
        timeout: 20000,
        env: {
          ...process.env,
          DATA_DIR: env.__dataDir,
          DB_CLIENT: "sqlite3",
          ...(env.__extra || {}),
        },
      },
    );
  } catch (error) {
    exitCode = error?.status ?? 1;
    stderr = error?.stderr?.toString?.() || "";
    stdout = error?.stdout?.toString?.() || "";
  }
  return { stdout, stderr, exitCode };
}

describe("restore-db.js SQLite live-server guard (low4a)", () => {
  test("aborts without touching the database file when the server is running", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-restore-live-"));
    const dataDir = path.join(tempRoot, "data");
    const backupDir = path.join(dataDir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });

    const backupFile = path.join(backupDir, "chatdesk-backup-live.db");
    fs.writeFileSync(backupFile, "NEW_BACKUP_DATA");

    const targetDb = path.join(dataDir, "chatdesk.db");
    fs.writeFileSync(targetDb, "OLD_LIVE_DATA");

    const { stderr, exitCode } = runRestore({
      __backupFile: backupFile,
      __dataDir: dataDir,
      __extra: {
        PORT: "59999", // any port — the preload makes the health probe succeed
        NODE_OPTIONS: `--require ${PRELOAD_PATH}`,
      },
    });

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/Stop ChatDesk on port 59999/);

    // The live database file must be untouched.
    expect(fs.readFileSync(targetDb, "utf8")).toBe("OLD_LIVE_DATA");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("proceeds with the restore when no server is running on the port", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-restore-idle-"));
    const dataDir = path.join(tempRoot, "data");
    const backupDir = path.join(dataDir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });

    const backupFile = path.join(backupDir, "chatdesk-backup-idle.db");
    fs.writeFileSync(backupFile, "RESTORED_DATA");

    const targetDb = path.join(dataDir, "chatdesk.db");
    fs.writeFileSync(targetDb, "OLD_DATA");

    // Port 9 (discard) is not served by the health probe in this child (no
    // preload): detectRunningServer's fetch fails fast → server not running.
    const { exitCode } = runRestore({
      __backupFile: backupFile,
      __dataDir: dataDir,
      __extra: { PORT: "9" },
    });

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(targetDb, "utf8")).toBe("RESTORED_DATA");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
