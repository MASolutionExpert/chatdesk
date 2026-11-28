import { describe, test, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";

// ─── F2: server-side session expiry ───────────────────────────────────────────
//
// The session cookie carries Max-Age=14d, but nothing rejected or pruned
// sessions on the server, so a leaked token worked forever. index.js now:
//   * rejects (and deletes) sessions whose last_seen/created_at is older
//     than the TTL (SESSION_TTL_DAYS, default 14 — matches the cookie);
//   * prunes such rows on a fixed interval (unref'd, so tests never hang).
//
// These behaviors live in server/index.js (db.js is out of scope), so this
// test boots the real server against a throw-away SQLite DATA_DIR and pins
// the HTTP-visible behavior end to end.

const serverDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BOOT_TIMEOUT_MS = 40_000;

let child = null;
let dataDir = null;
let port = null;

function bootServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-expiry-"));
  port = 20000 + Math.floor(Math.random() * 15000);

  child = spawn(process.execPath, ["index.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      SERVER_PORT: String(port),
      BIND_ADDRESS: "127.0.0.1",
      DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`boot timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`)),
      BOOT_TIMEOUT_MS,
    );
    child.stdout.on("data", (d) => {
      if (stdout.includes("ChatDesk server running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`server exited early code=${code} signal=${signal}\nstderr:\n${stderr}`));
    });
  });
}

function openDb() {
  return new Database(path.join(dataDir, "chatdesk.db"));
}

const isoToSqlite = (ms) =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");

async function getMe(token) {
  const res = await fetch(`http://127.0.0.1:${port}/api/me`, {
    headers: { cookie: `sid=${token}` },
  });
  return res.status;
}

async function sessionRowExists(token) {
  const db = openDb();
  try {
    const row = db
      .prepare("SELECT token FROM sessions WHERE token = ?")
      .get(token);
    return Boolean(row);
  } finally {
    db.close();
  }
}

afterAll(() => {
  if (child) {
    child.kill("SIGTERM");
  }
  if (dataDir) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("server-side session expiry (F2)", () => {
  test(
    "an expired session is rejected (401), its row deleted; a fresh session still works",
    { timeout: 60_000 },
    async () => {
      await bootServer();

      const userId = "expiry-user-1";
      const expiredToken = "expired-session-token";
      const freshToken = "fresh-session-token";
      const now = Date.now();
      const twentyDaysAgo = isoToSqlite(now - 20 * 24 * 60 * 60 * 1000);
      const nowStamp = isoToSqlite(now);

      const db = openDb();
      try {
        db.prepare(
          "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
        ).run(userId, "expirytester", "not-a-real-hash");
        const insertSession = db.prepare(
          "INSERT INTO sessions (user_id, token, created_at, last_seen) VALUES (?, ?, ?, ?)",
        );
        insertSession.run(userId, expiredToken, twentyDaysAgo, twentyDaysAgo);
        insertSession.run(userId, freshToken, nowStamp, nowStamp);
      } finally {
        db.close();
      }

      // Fresh session: /api/me works.
      expect(await getMe(freshToken)).toBe(200);
      expect(await sessionRowExists(freshToken)).toBe(true);

      // Expired session (last_seen 20 days ago > 14-day TTL): rejected AND
      // the row is deleted server-side.
      expect(await getMe(expiredToken)).toBe(401);
      expect(await sessionRowExists(expiredToken)).toBe(false);

      // The fresh session is untouched by the expired one's rejection.
      expect(await getMe(freshToken)).toBe(200);
    },
  );

  test("SESSION_TTL_DAYS is env-overridable (1-day TTL rejects a 2-day-old session)", { timeout: 90_000 }, async () => {
    // Reuses the same running server only for sanity of isolation — the TTL
    // is read once at boot, so this boots a second instance on another port.
    const child2DataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-expiry-ttl-"));
    const child2Port = 20000 + Math.floor(Math.random() * 15000);
    const child2 = spawn(process.execPath, ["index.js"], {
      cwd: serverDir,
      env: {
        ...process.env,
        SERVER_PORT: String(child2Port),
        BIND_ADDRESS: "127.0.0.1",
        DATA_DIR: child2DataDir,
        SESSION_TTL_DAYS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout2 = "";
    child2.stdout.on("data", (d) => (stdout2 += d.toString()));
    let stderr2 = "";
    child2.stderr.on("data", (d) => (stderr2 += d.toString()));

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`boot 2 timed out\n${stderr2}`)),
          BOOT_TIMEOUT_MS,
        );
        child2.stdout.on("data", (d) => {
          if (stdout2.includes("ChatDesk server running")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child2.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`server 2 exited early code=${code}\n${stderr2}`));
        });
      });

      const userId = "expiry-user-2";
      const oldToken = "two-day-old-session-token";
      const twoDaysAgo = isoToSqlite(Date.now() - 2 * 24 * 60 * 60 * 1000);

      const db = new Database(path.join(child2DataDir, "chatdesk.db"));
      try {
        db.prepare(
          "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
        ).run(userId, "expirytester2", "not-a-real-hash");
        db.prepare(
          "INSERT INTO sessions (user_id, token, created_at, last_seen) VALUES (?, ?, ?, ?)",
        ).run(userId, oldToken, twoDaysAgo, twoDaysAgo);
      } finally {
        db.close();
      }

      const res = await fetch(`http://127.0.0.1:${child2Port}/api/me`, {
        headers: { cookie: `sid=${oldToken}` },
      });
      expect(res.status).toBe(401);
    } finally {
      child2.kill("SIGTERM");
      fs.rmSync(child2DataDir, { recursive: true, force: true });
    }
  });
});
