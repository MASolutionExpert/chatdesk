import { describe, test, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 HIGH (auth review #2) — owner impersonation PRODUCTION wiring.
//
// The makeApp-based impersonate API tests pass because the test helper
// injects BOTH `getSession` and an options-aware `createSession` into the
// route deps. The production wiring in server/index.js did not:
//   (a) createSessionCombined(userId, token) dropped the 3rd `options` arg,
//       so `sessions.impersonated_by` was never stored — /api/me lost its
//       `impersonatedBy`, no banner, and the session was indistinguishable
//       from a real login;
//   (b) `getSession` was missing from apiDeps entirely, so
//       POST /api/admin/impersonate/return threw a TypeError → 500 — the
//       owner could never get back.
//
// This suite boots the REAL server (index.js, SQLite, temp DATA_DIR) and
// drives the whole impersonation round-trip over HTTP, pinning both fixes.
// ─────────────────────────────────────────────────────────────────────────────

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-imp-wiring-"));

const freePort = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});

const BASE = `http://127.0.0.1:${freePort}`;

const child = spawn(process.execPath, ["index.js"], {
  cwd: serverDir,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    SERVER_PORT: String(freePort),
    BIND_ADDRESS: "127.0.0.1",
    DB_CLIENT: "sqlite3",
    // Force the in-process redis fallback — no external services in tests.
    REDIS_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

afterAll(() => {
  try {
    child.kill("SIGTERM");
  } catch {}
});

async function waitForBoot(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not boot within ${timeoutMs}ms`);
}

const cookiesOf = (res) => {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(";")[0]);
};

describe("impersonation production wiring (real server boot)", () => {
  test("the minted session is stamped with impersonated_by and the owner can return", async () => {
    await waitForBoot();

    // First-setup rule: the FIRST registered user becomes the owner, so no
    // claim flow is needed.
    const regA = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "wiringowner", password: "pw-owner-123", nickname: "Owner" }),
    });
    expect(regA.status).toBe(200);
    const ownerCookies = cookiesOf(regA);
    const ownerSid = ownerCookies.find((c) => c.startsWith("sid="));
    expect(ownerSid).toBeTruthy();
    const ownerUserId = (await regA.json()).id;
    expect((await Promise.resolve(ownerUserId))).toBeTruthy();

    const regB = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "wiringplain", password: "pw-plain-123", nickname: "Plain" }),
    });
    expect(regB.status).toBe(200);
    const plainUserId = (await regB.json()).id;
    expect(plainUserId).toBeTruthy();

    // Owner impersonates the plain user.
    const imp = await fetch(`${BASE}/api/admin/users/${plainUserId}/impersonate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerSid },
      body: "{}",
    });
    expect(imp.status).toBe(200);
    const impJson = await imp.json();
    expect(impJson.impersonated).toBe(true);
    const impCookies = cookiesOf(imp);
    const mintedSid = impCookies.find((c) => c.startsWith("sid=") && !ownerCookies.includes(c));
    const parkedAdminSid = impCookies.find((c) => c.startsWith("admin_sid="));
    expect(mintedSid).toBeTruthy();
    expect(parkedAdminSid).toBe(`admin_sid=${ownerSid.slice(4)}`);

    // FIX (a): the options argument reaches db.createSession through the
    // combined wiring → sessions.impersonated_by is stored → /api/me
    // exposes impersonatedBy (the client banner depends on it).
    const dbPath = path.join(dataDir, "chatdesk.db");
    const row = new Database(dbPath, { readonly: true })
      .prepare("SELECT user_id, impersonated_by FROM sessions WHERE token = ?")
      .get(mintedSid.slice(4));
    expect(row).toBeTruthy();
    expect(row.user_id).toBe(plainUserId);
    expect(row.impersonated_by).toBe(ownerUserId);

    const me = await fetch(`${BASE}/api/me`, {
      headers: { Cookie: mintedSid },
    });
    expect(me.status).toBe(200);
    const meJson = await me.json();
    expect(meJson.user?.impersonatedBy?.id ?? meJson.impersonatedBy?.id).toBe(
      ownerUserId,
    );

    // FIX (b): getSession is wired into apiDeps → the return endpoint no
    // longer throws a TypeError / 500; the owner gets their session back.
    const back = await fetch(`${BASE}/api/admin/impersonate/return`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${mintedSid}; ${parkedAdminSid}`,
      },
      body: "{}",
    });
    expect(back.status).toBe(200);
    const backJson = await back.json();
    expect(backJson.username).toBe("wiringowner");

    // The minted session was revoked; the owner session still resolves.
    const revoked = new Database(dbPath, { readonly: true })
      .prepare("SELECT id FROM sessions WHERE token = ?")
      .get(mintedSid.slice(4));
    expect(revoked).toBeUndefined();
    const kept = new Database(dbPath, { readonly: true })
      .prepare("SELECT user_id FROM sessions WHERE token = ?")
      .get(ownerSid.slice(4));
    expect(kept?.user_id).toBe(ownerUserId);
  });
});
