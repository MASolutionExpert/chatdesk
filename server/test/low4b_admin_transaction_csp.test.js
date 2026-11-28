/**
 * Stage 4 (LOW) security-fix tests — Task 4-b items 4 and 6:
 *
 * 4. /api/admin/db-tools multi-statement actions must run through
 *    adminTransaction (a real knex transaction pinning one connection) —
 *    BEGIN/COMMIT/ROLLBACK sent as plain statements through the pooled
 *    adminRun do not form a transaction on Postgres.
 * 6. CSP header helper: default policy, CSP_HEADER override, and the
 *    CSP_REPORT_ONLY switch.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeApp } from "./helpers/makeApp.js";
import { buildCspHeader } from "./lib/csp.js";

// ─── Item 4: db-tools transactions ────────────────────────────────────────────

function makeDbToolsApp({ adminGetAll, adminRun, adminTransaction, adminSave } = {}) {
  process.env.ADMIN_API_TOKEN = "test-admin-token";
  return makeApp({
    deps: {
      isLoopbackRequest: () => true,
      adminGetAll: adminGetAll || vi.fn(async () => []),
      adminGetRow: vi.fn(async () => null),
      adminRun: adminRun || vi.fn(async () => 1),
      // Always spread (even when undefined) so an explicit undefined overrides
      // the makeApp default stub — that is how the legacy fallback is forced.
      adminTransaction,
      adminSave: adminSave || vi.fn(),
      removeStoredFileNames: vi.fn(),
    },
  }).app;
}

const postDbTools = (app, body) =>
  request(app)
    .post("/api/admin/db-tools")
    .set("x-chatdesk-admin-token", "test-admin-token")
    .send(body);

beforeEach(() => {
  process.env.ADMIN_API_TOKEN = "test-admin-token";
});

afterEach(() => {
  delete process.env.ADMIN_API_TOKEN;
  vi.restoreAllMocks();
});

describe("LOW 4-b: db-tools actions use adminTransaction", () => {
  test("delete_chats routes every statement through the transaction callback", async () => {
    const events = [];
    const transactionRun = vi.fn(async (sql, params) => {
      events.push(`TX:${String(sql).trim().split(/\s+/)[0].toUpperCase()}`);
      return 1;
    });
    const adminTransaction = vi.fn(async (callback) => callback(transactionRun));
    const adminRun = vi.fn(async () => 1);

    const app = makeDbToolsApp({
      adminGetAll: vi.fn(async () => [{ stored_name: "a.bin" }]),
      adminRun,
      adminTransaction,
    });

    const res = await postDbTools(app, {
      action: "delete_chats",
      payload: { chatIds: ["12"] },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: { removedChats: 1, removedFiles: 1 },
    });

    // The real transaction helper was used (not pooled BEGIN/COMMIT).
    expect(adminTransaction).toHaveBeenCalledTimes(1);
    expect(typeof adminTransaction.mock.calls[0][0]).toBe("function");

    // The DELETEs went through the trx, and the route itself never sent
    // pooled BEGIN/COMMIT/ROLLBACK statements.
    expect(events).toContain("TX:DELETE");
    expect(events.filter((e) => e === "TX:DELETE").length).toBe(9);
    for (const call of adminRun.mock.calls) {
      expect(String(call[0]).toUpperCase()).not.toBe("BEGIN");
      expect(String(call[0]).toUpperCase()).not.toBe("COMMIT");
      expect(String(call[0]).toUpperCase()).not.toBe("ROLLBACK");
    }
  });

  test("an error inside the transaction still surfaces ROLLBACK semantics via adminTransaction", async () => {
    const events = [];
    let callCount = 0;
    const transactionRun = vi.fn(async (sql) => {
      callCount += 1;
      if (callCount >= 4) {
        // The 4th statement (DELETE FROM chat_messages) blows up.
        throw new Error("constraint violation");
      }
      events.push(`TX:${String(sql).trim().split(/\s+/)[0].toUpperCase()}`);
      return 1;
    });
    // Mirrors the real adminTransaction contract: ROLLBACK on error, then rethrow.
    const adminTransaction = vi.fn(async (callback) => {
      try {
        return await callback(transactionRun);
      } catch (error) {
        events.push("ROLLBACK");
        throw error;
      }
    });

    const app = makeDbToolsApp({
      adminGetAll: vi.fn(async () => [{ stored_name: "a.bin" }]),
      adminTransaction,
    });

    const res = await postDbTools(app, {
      action: "delete_chats",
      payload: { chatIds: ["12"] },
    });

    expect(res.status).toBe(500);
    expect(events).toContain("ROLLBACK");
    // The rollback happens exactly once and only successful statements were logged.
    expect(events.filter((e) => e === "ROLLBACK")).toHaveLength(1);
    expect(adminTransaction).toHaveBeenCalledTimes(1);
  });

  test("falls back to pooled adminRun BEGIN/COMMIT when adminTransaction is not wired", async () => {
    const events = [];
    const adminRun = vi.fn(async (sql) => {
      events.push(String(sql).trim().split(/\s+/)[0].toUpperCase());
      return 1;
    });

    const app = makeDbToolsApp({
      adminGetAll: vi.fn(async () => []),
      adminRun,
      adminTransaction: undefined, // force the legacy fallback
    });

    const res = await postDbTools(app, {
      action: "delete_chats",
      payload: { chatIds: ["12"] },
    });

    expect(res.status).toBe(200);
    expect(events[0]).toBe("BEGIN");
    expect(events).toContain("COMMIT");
    expect(events.indexOf("COMMIT")).toBeGreaterThan(events.indexOf("BEGIN"));
    expect(events).not.toContain("ROLLBACK");
  });

  test("fallback path executes ROLLBACK when a pooled statement fails", async () => {
    const events = [];
    let callCount = 0;
    const adminRun = vi.fn(async (sql) => {
      const statement = String(sql).trim().split(/\s+/)[0].toUpperCase();
      callCount += 1;
      if (statement === "DELETE" && callCount >= 5) {
        throw new Error("boom");
      }
      events.push(statement);
      return 1;
    });

    const app = makeDbToolsApp({
      adminGetAll: vi.fn(async () => []),
      adminRun,
      adminTransaction: undefined,
    });

    const res = await postDbTools(app, {
      action: "delete_chats",
      payload: { chatIds: ["12"] },
    });

    expect(res.status).toBe(500);
    expect(events).toContain("BEGIN");
    expect(events).toContain("ROLLBACK");
    expect(events).not.toContain("COMMIT");
  });
});

// ─── Item 6: CSP header helper ────────────────────────────────────────────────

const DEFAULT_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; " +
  "connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; form-action 'self'; " +
  "frame-ancestors 'none'";

describe("LOW 4-b: CSP header helper", () => {
  test("default policy is enforced (not report-only) and matches the reviewed policy", () => {
    const csp = buildCspHeader({});
    expect(csp.headerName).toBe("Content-Security-Policy");
    expect(csp.header).toBe(DEFAULT_POLICY);
  });

  test("default policy keeps the SPA working (inline theme script/styles allowed)", () => {
    const { header } = buildCspHeader({});
    // client/dist/index.html ships inline <script> + <style>
    expect(header).toContain("script-src 'self' 'unsafe-inline'");
    expect(header).toContain("style-src 'self' 'unsafe-inline'");
    // markdown/avatars/media
    expect(header).toContain("img-src 'self' data: blob: https:");
    expect(header).toContain("media-src 'self' blob: https:");
    expect(header).toContain("connect-src 'self' https: wss:");
    // hardening directives
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("frame-ancestors 'none'");
    expect(header).toContain("base-uri 'self'");
    expect(header).toContain("form-action 'self'");
  });

  test("CSP_REPORT_ONLY=1 switches to the Report-Only header", () => {
    const csp = buildCspHeader({ CSP_REPORT_ONLY: "1" });
    expect(csp.headerName).toBe("Content-Security-Policy-Report-Only");
    expect(csp.header).toBe(DEFAULT_POLICY);
  });

  test("CSP_HEADER is used verbatim (and combines with CSP_REPORT_ONLY)", () => {
    const custom = "default-src 'self'; script-src 'self'";
    const enforced = buildCspHeader({ CSP_HEADER: custom });
    expect(enforced.headerName).toBe("Content-Security-Policy");
    expect(enforced.header).toBe(custom);

    const reportOnly = buildCspHeader({ CSP_HEADER: custom, CSP_REPORT_ONLY: "true" });
    expect(reportOnly.headerName).toBe("Content-Security-Policy-Report-Only");
    expect(reportOnly.header).toBe(custom);
  });

  test("CSP_HEADER='off' disables the header entirely", () => {
    const csp = buildCspHeader({ CSP_HEADER: "off" });
    expect(csp.header).toBe("");
    expect(csp.headerName).toBeNull();
  });
});
