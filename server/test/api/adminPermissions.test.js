import { describe, test, expect } from "vitest";
import request from "supertest";
import { makeApp, makeSessionStore, makeUserStore } from "../helpers/makeApp.js";
import { ALL_PERMISSION_KEYS } from "../../lib/permissions.js";

const ownerId = "a0000000-0000-4000-8000-000000000001";

function makeOwnerApp(deps = {}) {
  const owner = { id: ownerId, username: "boss", nickname: "Boss", role: "owner" };
  const sessionStore = makeSessionStore();
  sessionStore.createSession(owner.id, "owner-session");
  const { app, deps: wired } = makeApp({
    sessionStore,
    userStore: makeUserStore([
      owner,
      { id: "b0000000-0000-4000-8000-000000000002", username: "op", nickname: "Op", role: "operator" },
      { id: "c0000000-0000-4000-8000-000000000003", username: "alice", nickname: "Alice", role: "user" },
    ]),
    deps: {
      isUserOwner: (userId) => userId === ownerId,
      ...deps,
    },
  });
  // Route gating reads deps.hasPermission; wire it through the override
  // store so admin PUTs take effect on the very same app (mirrors prod,
  // where the service cache invalidates eagerly on writes).
  wired.hasPermission = (role, key) => wired.permissionsService.isAllowed(role, key);
  wired.getAllowedPermissions = (role) => wired.permissionsService.getAllowedKeys(role);
  return { app, service: wired.permissionsService, deps: wired };
}

async function putPermission(app, body) {
  return request(app)
    .put("/api/admin/permissions")
    .set("Cookie", "sid=owner-session")
    .send(body);
}

describe("GET /api/admin/permissions", () => {
  test("returns the registry matrix with bilingual labels and owner-always-full", async () => {
    const { app } = makeOwnerApp();
    const res = await request(app)
      .get("/api/admin/permissions")
      .set("Cookie", "sid=owner-session");
    expect(res.status).toBe(200);
    expect(res.body.ownerAlwaysFull).toBe(true);
    expect(res.body.roles).toEqual(["operator", "user"]);
    expect(res.body.groups.length).toBeGreaterThanOrEqual(4);
    expect(res.body.permissions.map((p) => p.key).sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
    for (const def of res.body.permissions) {
      expect(def.labelEn).toBeTruthy();
      expect(def.labelFa).toBeTruthy();
      expect(Object.keys(def.roles).sort()).toEqual(["operator", "user"]);
    }
    const refer = res.body.permissions.find((p) => p.key === "ticket.refer");
    expect(refer.roles.operator.effective).toBe(true);
    expect(refer.roles.user.effective).toBe(false);
  });

  test("is owner-gated (operators and anonymous users get 401/403)", async () => {
    const { app } = makeOwnerApp();
    const anon = await request(app).get("/api/admin/permissions");
    expect([401, 403]).toContain(anon.status);
  });
});

describe("PUT /api/admin/permissions", () => {
  test("stores an override and returns the new effective value", async () => {
    const { app, service } = makeOwnerApp();
    const res = await putPermission(app, {
      role: "user",
      permission: "ticket.refer",
      allowed: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.effective).toBe(true);
    // The override store received the row (mirrors role_permissions):
    expect(await service.isAllowed("user", "ticket.refer")).toBe(true);
  });

  test("allowed:null resets to the registry default", async () => {
    const { app, service } = makeOwnerApp();
    await putPermission(app, { role: "user", permission: "ticket.refer", allowed: true });
    const res = await putPermission(app, {
      role: "user",
      permission: "ticket.refer",
      allowed: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.effective).toBe(false); // registry default for user
    expect(await service.listOverrides()).toEqual([]);
  });

  test("rejects the owner role — the owner always has full access", async () => {
    const { app } = makeOwnerApp();
    const res = await putPermission(app, {
      role: "owner",
      permission: "dm.send",
      allowed: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configurable|owner/i);
  });

  test("rejects unknown permission keys", async () => {
    const { app } = makeOwnerApp();
    const res = await putPermission(app, {
      role: "user",
      permission: "made.up.key",
      allowed: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown permission/i);
  });

  test("rejects non-boolean allowed values", async () => {
    const { app } = makeOwnerApp();
    const res = await putPermission(app, {
      role: "user",
      permission: "dm.send",
      allowed: "yes",
    });
    expect(res.status).toBe(400);
  });

  test("every permission change is audited", async () => {
    const { app, deps } = makeOwnerApp();
    await putPermission(app, { role: "operator", permission: "ticket.refer", allowed: false });
    const logs = deps.readAdminAuditLogs({ limit: 10 });
    const entries = logs.entries || [];
    const entry = entries.find((l) => l.action === "permission.update");
    expect(entry).toBeTruthy();
    expect(entry.targetLabel).toBe("operator:ticket.refer");
  });

  test("an override stored via PUT is honoured by hasPermission on the same app", async () => {
    const { app, deps } = makeOwnerApp();
    await putPermission(app, { role: "user", permission: "ticket.refer", allowed: true });
    expect(await deps.hasPermission("user", "ticket.refer")).toBe(true);
    await putPermission(app, { role: "operator", permission: "ticket.refer", allowed: false });
    expect(await deps.hasPermission("operator", "ticket.refer")).toBe(false);
  });
});
