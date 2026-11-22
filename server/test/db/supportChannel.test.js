import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Migration 044 — chat channel separation (`chats.channel`).
//
// ChatDesk carries two strictly separated kinds of DM conversations:
//   - "direct"  : messenger-style chats opened by finding a user's ID
//   - "support" : helpdesk threads opened through the department picker
//
// Guarantees under test:
//   * every chat has an explicit channel (default "direct")
//   * support threads are tagged by markChatDepartment + department_id
//   * findDmChat can target a specific channel (support request flow MUST
//     never reuse/convert a plain direct chat between the same pair)
//   * channel + department name flow through listChatsForUser (chat list)
//   * adminListChats can filter by channel (admin panel separation)
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; this suite is SQLite-only.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-channel-"));

const {
  createUser,
  createChat,
  addChatMember,
  createDepartment,
  markChatDepartment,
  getChatDepartmentId,
  findDmChat,
  listChatsForUser,
  adminListChats,
  setUserDepartment,
} = await import("../../db.js");

const sync = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

describe("chat channel separation (direct vs support)", () => {
  const customerId = createUser("channel-cust", "hash", "Customer", null, null, {
    role: "user",
  });
  const operatorId = createUser("channel-op", "hash", "Operator", null, null, {
    role: "operator",
  });

  test("every chat defaults to an explicit 'direct' channel", async () => {
    const chatId = await sync(createChat(null, "dm"));
    expect(chatId).toBeTruthy();
    await sync(addChatMember(chatId, customerId, "owner"));
    await sync(addChatMember(chatId, operatorId, "member"));
    const conv = (await sync(listChatsForUser(customerId))).find(
      (c) => c.id === chatId,
    );
    expect(conv.channel).toBe("direct");
    expect(conv.department_id ?? null).toBeNull();
    expect(conv.department_name ?? null).toBeNull();
  });

  test("markChatDepartment tags the chat as a support thread", async () => {
    const dept = await sync(
      createDepartment({ name: "Billing", description: "b" }),
    );
    expect(dept?.id).toBeTruthy();

    const chatId = await sync(createChat(null, "dm", { channel: "support" }));
    await sync(addChatMember(chatId, customerId, "owner"));
    await sync(addChatMember(chatId, operatorId, "member"));
    await sync(markChatDepartment(chatId, dept.id));

    expect(await sync(getChatDepartmentId(chatId))).toBe(Number(dept.id));

    const conv = (await sync(listChatsForUser(customerId))).find(
      (c) => c.id === chatId,
    );
    expect(conv.channel).toBe("support");
    expect(Number(conv.department_id)).toBe(Number(dept.id));
    expect(conv.department_name).toBe("Billing");

    // clearing the department demotes the chat back to a direct chat
    await sync(markChatDepartment(chatId, null));
    const conv2 = (await sync(listChatsForUser(customerId))).find(
      (c) => c.id === chatId,
    );
    expect(conv2.channel).toBe("direct");
    expect(conv2.department_id ?? null).toBeNull();
  });

  test("findDmChat keeps direct and support threads strictly separate", async () => {
    const dept = await sync(createDepartment({ name: "Sales" }));

    // The pair gets one direct chat and one support chat for the department.
    const directId = await sync(createChat(null, "dm"));
    await sync(addChatMember(directId, customerId, "owner"));
    await sync(addChatMember(directId, operatorId, "member"));

    const supportId = await sync(
      createChat(null, "dm", { channel: "support" }),
    );
    await sync(addChatMember(supportId, customerId, "owner"));
    await sync(addChatMember(supportId, operatorId, "member"));
    await sync(markChatDepartment(supportId, dept.id));

    // Channel-scoped lookups resolve to the right thread.
    const foundDirect = await sync(
      findDmChat(customerId, operatorId, { channel: "direct" }),
    );
    // The pair may own several direct chats (earlier tests created some);
    // the invariant is that the direct lookup never resolves to a support
    // thread and the support lookup resolves to exactly this thread.
    expect(foundDirect).toBeTruthy();
    expect(foundDirect).not.toBe(supportId);

    const foundSupport = await sync(
      findDmChat(customerId, operatorId, {
        channel: "support",
        departmentId: dept.id,
      }),
    );
    expect(foundSupport).toBe(supportId);
    expect(foundDirect).not.toBe(foundSupport);

    // A support request for a DIFFERENT department must not reuse either
    // (the route will create a fresh thread instead of converting these).
    const otherDept = await sync(createDepartment({ name: "Other" }));
    const otherId = await sync(
      findDmChat(customerId, operatorId, {
        channel: "support",
        departmentId: otherDept.id,
      }),
    );
    expect(otherId).toBeNull();

    // Unfiltered lookup still works (legacy behaviour).
    const anyId = await sync(findDmChat(customerId, operatorId));
    expect([directId, supportId]).toContain(anyId);
  });

  test("adminListChats separates support tickets from direct messages", async () => {
    const supportPage = await sync(adminListChats({ channelFilter: "support" }));
    const directPage = await sync(adminListChats({ channelFilter: "direct" }));

    for (const chat of supportPage.chats) {
      expect(chat.channel).toBe("support");
      expect(chat.department_id).not.toBeNull();
      expect(chat.department_name).toBe("Sales");
    }
    for (const chat of directPage.chats) {
      expect(chat.channel).toBe("direct");
    }

    const supportIds = supportPage.chats.map((c) => c.id);
    const directIds = directPage.chats.map((c) => c.id);
    for (const id of supportIds) expect(directIds).not.toContain(id);

    // no filter → everything (existing behaviour preserved)
    const all = await sync(adminListChats({}));
    expect(all.total).toBe(supportPage.total + directPage.total);
  });

  test("setUserDepartment still exists for operator assignment", async () => {
    const dept = await sync(createDepartment({ name: "Temp" }));
    const ok = await sync(setUserDepartment(operatorId, dept.id));
    expect(ok).toBe(true);
    await sync(setUserDepartment(operatorId, null));
  });
});
