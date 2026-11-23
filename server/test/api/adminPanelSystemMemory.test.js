import { describe, test, expect } from "vitest";
import request from "supertest";
import { makeApp, makeSessionStore } from "../helpers/makeApp.js";
import v8 from "node:v8";

// The dashboard's app-memory gauge used to divide heapUsed by heapTotal —
// but V8's GC keeps live usage NEAR the allocated heap by design, so a
// perfectly healthy process read 85-95% "red" forever. The endpoint must
// expose the real ceiling (v8 heap_size_limit) so the gauge measures
// heapUsed/heapLimit.
describe("GET /api/admin/system — memory metrics", () => {
  test("exposes the V8 heap limit as the app-memory ceiling", async () => {
    const admin = {
      id: "a0000000-0000-4000-8000-000000000001",
      username: "admin",
      nickname: "Admin",
      role: "admin",
    };
    const sessionStore = makeSessionStore();
    sessionStore.createSession(admin.id, "admin-session");
    const { app } = makeApp({
      sessionStore,
      userStore: {
        findUserById: async (id) => (id === admin.id ? admin : null),
      },
      deps: { isUserAdmin: (userId) => userId === admin.id },
    });

    const res = await request(app)
      .get("/api/admin/system")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(200);

    const memory = res.body.memory;
    expect(memory).toBeTruthy();
    expect(Number(memory.heapLimit)).toBeGreaterThan(0);
    expect(Number(memory.heapLimit)).toBeGreaterThanOrEqual(
      Number(memory.heapTotal),
    );
    expect(memory.heapLimit).toBe(v8.getHeapStatistics().heap_size_limit);
    // A healthy process sits far below its real limit.
    const pct = (memory.heapUsed / memory.heapLimit) * 100;
    expect(pct).toBeLessThan(50);
  });
});
