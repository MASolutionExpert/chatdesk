import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import {
  makeApp,
  makeSessionStore,
  makeUserStore,
} from "../helpers/makeApp.js";
import { parseCallMessageBody } from "../../db.js";

function makeAdminApp(adminDeps = {}) {
  const admin = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    username: "admin",
    nickname: "Admin",
    role: "admin",
  };
  const sessionStore = makeSessionStore();
  sessionStore.createSession(admin.id, "admin-session");
  const { app } = makeApp({
    sessionStore,
    userStore: makeUserStore([admin]),
    deps: {
      isUserAdmin: (userId) => userId === admin.id,
      ...adminDeps,
    },
  });
  return { app };
}

describe("GET /api/admin/calls (call-history report)", () => {
  it("requires admin access", async () => {
    const user = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      username: "sam",
      nickname: "Sam",
      role: "user",
    };
    const sessionStore = makeSessionStore();
    sessionStore.createSession(user.id, "user-session");
    const { app } = makeApp({
      sessionStore,
      userStore: makeUserStore([user]),
      deps: {
        isUserAdmin: () => false,
        adminListCalls: vi.fn(),
      },
    });
    const res = await request(app)
      .get("/api/admin/calls")
      .set("Cookie", "sid=user-session");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it("requires authentication", async () => {
    const { app } = makeApp({ deps: { adminListCalls: vi.fn() } });
    const res = await request(app).get("/api/admin/calls");
    expect(res.status).toBe(401);
  });

  it("returns the parsed call list and total", async () => {
    const adminListCalls = vi.fn().mockResolvedValue({
      calls: [
        {
          id: "c1",
          chat_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          body: "[[call:video:connected:125]]",
          created_at: "2026-01-01T10:00:00.000Z",
          caller_username: "hasan",
          caller_nickname: "حسن",
          chat_name: null,
          chat_type: "dm",
          participants: "hasan, lida",
          type: "video",
          status: "connected",
          durationSeconds: 125,
        },
      ],
      total: 1,
    });
    const { app } = makeAdminApp({ adminListCalls });
    const res = await request(app)
      .get("/api/admin/calls")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0]).toMatchObject({
      type: "video",
      status: "connected",
      durationSeconds: 125,
      caller_username: "hasan",
    });
  });

  it("passes type and status filters through", async () => {
    const adminListCalls = vi.fn().mockResolvedValue({ calls: [], total: 0 });
    const { app } = makeAdminApp({ adminListCalls });
    const res = await request(app)
      .get("/api/admin/calls?type=video&status=missed&sortBy=caller&sortDir=asc")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(200);
    expect(adminListCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        typeFilter: "video",
        statusFilter: "missed",
        sortBy: "caller",
        sortDir: "ASC",
      }),
    );
  });

  it("rejects invalid filter values gracefully", async () => {
    const adminListCalls = vi.fn().mockResolvedValue({ calls: [], total: 0 });
    const { app } = makeAdminApp({ adminListCalls });
    const res = await request(app)
      .get("/api/admin/calls?type=bogus&status=bogus&chat=not-a-uuid")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(200);
    expect(adminListCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        typeFilter: null,
        statusFilter: null,
        chatFilter: null,
      }),
    );
  });

  it("passes search through", async () => {
    const adminListCalls = vi.fn().mockResolvedValue({ calls: [], total: 0 });
    const { app } = makeAdminApp({ adminListCalls });
    const res = await request(app)
      .get("/api/admin/calls?search=hasan")
      .set("Cookie", "sid=admin-session");
    expect(res.status).toBe(200);
    expect(adminListCalls).toHaveBeenCalledWith(
      expect.objectContaining({ search: "hasan" }),
    );
  });
});

describe("parseCallMessageBody", () => {
  it("parses every call-log shape", () => {
    expect(parseCallMessageBody("[[call:audio:connected:65]]")).toEqual({
      type: "audio",
      status: "connected",
      durationSeconds: 65,
    });
    expect(parseCallMessageBody("[[call:video:missed]]")).toEqual({
      type: "video",
      status: "missed",
      durationSeconds: null,
    });
    expect(
      parseCallMessageBody("[[call:audio:declined:0]]"),
    ).toMatchObject({ status: "declined" });
  });

  it("rejects non-call bodies and malformed shapes", () => {
    expect(parseCallMessageBody("hello")).toBeNull();
    expect(parseCallMessageBody("[[call:voice:missed]]")).toBeNull();
    expect(parseCallMessageBody("[[call:audio:unknown:5]]")).toBeNull();
    expect(parseCallMessageBody("[[call:audio:connected:abc]]")).toBeNull();
    expect(parseCallMessageBody(null)).toBeNull();
    expect(parseCallMessageBody(42)).toBeNull();
    expect(parseCallMessageBody("[[call:audio:outgoing:12:extra]]")).toBeNull();
  });
});
