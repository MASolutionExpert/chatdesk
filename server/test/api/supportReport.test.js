import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import {
  makeApp,
  makeSessionStore,
  makeUserStore,
} from "../helpers/makeApp.js";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/support/report — time-filtered department/operator
// performance report.
//
// Contract: admin sessions only (operators and customers get 403), query
// params are validated before the db layer is touched, a departmentId that
// does not exist is a 404, and the response body is whatever the db layer's
// getSupportReport produced.
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeAdminApp({ getSupportReport } = {}) {
  const admin = {
    id: ADMIN_ID,
    username: "admin",
    nickname: "Admin",
    role: "admin",
  };
  const operator = {
    id: OPERATOR_ID,
    username: "bob",
    nickname: "Bob",
    role: "operator",
  };
  const sessionStore = makeSessionStore();
  sessionStore.createSession(ADMIN_ID, "admin-session");
  sessionStore.createSession(OPERATOR_ID, "operator-session");
  const spy = getSupportReport ?? vi.fn().mockResolvedValue({ range: { from: null, to: null }, departments: [] });
  const { app } = makeApp({
    sessionStore,
    userStore: makeUserStore([admin, operator]),
    deps: {
      isUserAdmin: (userId) => userId === ADMIN_ID,
      getSupportReport: spy,
    },
  });
  return { app, spy };
}

describe("GET /api/admin/support/report", () => {
  it("requires authentication", async () => {
    const { app } = makeAdminApp();
    const res = await request(app).get("/api/admin/support/report");
    expect(res.status).toBe(401);
  });

  it("forbids non-admin sessions (operator gets 403)", async () => {
    const { app } = makeAdminApp();
    const res = await request(app)
      .get("/api/admin/support/report")
      .set("Cookie", "sid=operator-session");
    expect(res.status).toBe(403);
  });

  it("returns the report for an admin session and echoes range params", async () => {
    const payload = {
      range: { from: "2025-06-01", to: "2025-06-30" },
      departments: [
        {
          id: 1,
          name: "Billing",
          color: "#10b981",
          active: true,
          operatorCount: 1,
          totals: {
            conversations: 4,
            messages: 12,
            customerMessages: 6,
            staffMessages: 6,
            ticketsOpened: 4,
            ticketsClosed: 2,
            openTickets: 2,
            answered: 3,
            unanswered: 1,
            avgFirstResponseSeconds: 90,
          },
          operators: [
            {
              id: OPERATOR_ID,
              username: "bob",
              nickname: "Bob",
              color: "#f59e0b",
              role: "operator",
              assigned: 4,
              answered: 3,
              unanswered: 1,
              messagesSent: 6,
              firstResponses: 4,
              avgFirstResponseSeconds: 90,
              ticketsOpened: 4,
              ticketsClosed: 2,
            },
          ],
        },
      ],
    };
    const { app, spy } = makeAdminApp({ getSupportReport: vi.fn().mockResolvedValue(payload) });
    const res = await request(app)
      .get("/api/admin/support/report?departmentId=1&from=2025-06-01&to=2025-06-30")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith({ departmentId: 1, from: "2025-06-01", to: "2025-06-30" });
    expect(res.body).toEqual(payload);
    expect(res.body.departments[0].totals.conversations).toBe(4);
    expect(res.body.departments[0].operators[0].username).toBe("bob");
  });

  it("passes null departmentId when none requested", async () => {
    const { app, spy } = makeAdminApp();
    const res = await request(app)
      .get("/api/admin/support/report")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith({ departmentId: null, from: null, to: null });
  });

  it("rejects an invalid departmentId with 400", async () => {
    const { app, spy } = makeAdminApp();
    const res = await request(app)
      .get("/api/admin/support/report?departmentId=abc")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an invalid date range with 400", async () => {
    const { app, spy } = makeAdminApp();
    const res = await request(app)
      .get("/api/admin/support/report?from=not-a-date")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("404s when the requested department does not exist", async () => {
    const { app } = makeAdminApp({
      getSupportReport: vi.fn().mockResolvedValue({ range: { from: null, to: null }, departments: [] }),
    });
    const res = await request(app)
      .get("/api/admin/support/report?departmentId=999")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Department not found.");
  });
});
