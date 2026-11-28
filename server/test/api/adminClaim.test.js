import { describe, test, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeApp } from "../helpers/makeApp.js";

describe("POST /api/admin/claim", () => {
  let app;
  let deps;

  beforeEach(() => {
    process.env.ADMIN_API_TOKEN = "test-admin-secret-token";
    deps = {
      getSessionFromRequest: (...args) => deps.onGetSession(...args),
      setUserRole: (...args) => deps.onSetUserRole(...args),
      // The claim endpoint mints the owner through a conditional raw UPDATE
      // (atomic owner-claim race guard) instead of setUserRole.
      adminRun: (...args) => deps.onAdminRun(...args),
      getRow: (...args) => deps.onGetRow(...args),
      writeAdminAuditLog: () => {},
    };
    deps.onGetSession = () => ({ id: "42424242-4242-4242-a242-424242424242", username: "testuser" });
    deps.onSetUserRole = async (id, role) => ({ id, role });
    deps.onAdminRun = async () => 1; // one row affected = owner minted
    deps.onGetRow = async (query) => {
      if (
        typeof query === "string" &&
        query.includes("users WHERE role = 'owner'")
      ) {
        return null; // No owner exists
      }
      return null;
    };

    app = makeApp({ deps }).app;
  });

  afterEach(() => {
    delete process.env.ADMIN_API_TOKEN;
  });

  test("rejects unauthenticated requests with 401", async () => {
    deps.onGetSession = () => null;
    const res = await request(app)
      .post("/api/admin/claim")
      .set("x-forwarded-proto", "https")
      .send({ token: "test-admin-secret-token" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Not authenticated");
  });

  test("rejects incorrect token with 401", async () => {
    const res = await request(app)
      .post("/api/admin/claim")
      .set("x-forwarded-proto", "https")
      .send({ token: "wrong-token" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid admin token");
  });

  test("promotes user to 'owner' when no owner exists (conditional atomic UPDATE)", async () => {
    let executedSql = null;
    let executedParams = null;
    deps.onAdminRun = async (sql, params) => {
      executedSql = sql;
      executedParams = params;
      return 1;
    };

    const res = await request(app)
      .post("/api/admin/claim")
      .set("x-forwarded-proto", "https")
      .send({ token: "test-admin-secret-token" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.role).toBe("owner");
    expect(String(executedSql)).toMatch(/UPDATE users SET role = 'owner'/i);
    expect(String(executedSql)).toMatch(/NOT EXISTS \(SELECT 1 FROM users WHERE role = 'owner'\)/i);
    expect(executedParams).toEqual(["42424242-4242-4242-a242-424242424242"]);
  });

  test("is an idempotent no-op when the caller is already the owner (never demotes)", async () => {
    deps.onGetRow = async (query) => {
      if (
        typeof query === "string" &&
        query.includes("users WHERE role = 'owner'")
      ) {
        return { id: "42424242-4242-4242-a242-424242424242", username: "testuser" };
      }
      return null;
    };

    let adminRunCalls = 0;
    let assignedRole = null;
    deps.onAdminRun = async () => {
      adminRunCalls++;
      return 1;
    };
    deps.onSetUserRole = async (_id, role) => {
      assignedRole = role;
      return { id: "42424242-4242-4242-a242-424242424242", role };
    };

    const res = await request(app)
      .post("/api/admin/claim")
      .set("x-forwarded-proto", "https")
      .send({ token: "test-admin-secret-token" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.role).toBe("owner");
    expect(adminRunCalls).toBe(0);
    expect(assignedRole).toBeNull(); // never demoted via setUserRole
  });

  test("refuses with 409 when a different owner already exists (no demotion)", async () => {
    deps.onGetRow = async (query) => {
      if (
        typeof query === "string" &&
        query.includes("users WHERE role = 'owner'")
      ) {
        return { id: "11111111-1111-4111-a111-111111111111", username: "existing_owner" };
      }
      return null;
    };

    let adminRunCalls = 0;
    let assignedRole = null;
    deps.onAdminRun = async () => {
      adminRunCalls++;
      return 1;
    };
    deps.onSetUserRole = async (_id, role) => {
      assignedRole = role;
      return { id: "42424242-4242-4242-a242-424242424242", role };
    };

    const res = await request(app)
      .post("/api/admin/claim")
      .set("x-forwarded-proto", "https")
      .send({ token: "test-admin-secret-token" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/owner already exists/i);
    expect(adminRunCalls).toBe(0);
    expect(assignedRole).toBeNull();
  });

  test("refuses with 409 when the conditional UPDATE affects 0 rows (lost claim race)", async () => {
    deps.onAdminRun = async () => 0; // concurrent claim already minted an owner

    const res = await request(app)
      .post("/api/admin/claim")
      .set("x-forwarded-proto", "https")
      .send({ token: "test-admin-secret-token" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/just created by another claim/i);
  });

  test("rejects remote non-HTTPS request with 403", async () => {
    const res = await request(app)
      .post("/api/admin/claim")
      .set("x-forwarded-proto", "http")
      .set("host", "example.com")
      .send({ token: "test-admin-secret-token" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/HTTPS connection required/i);
  });
});
