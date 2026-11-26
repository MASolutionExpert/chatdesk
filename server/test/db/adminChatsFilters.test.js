import { describe, test, expect } from "vitest";
import {
  adminListChats,
  createChat,
  createUser,
  addChatMember,
  run,
  getRow,
} from "../../db.js";

// ─────────────────────────────────────────────────────────────────────────────
// Real-SQLite integration for the admin chats list filters (1.4.0-dev.9):
//
//  1. type=support — the "Support messages" type filter — returns ONLY the
//     DM chats riding the support channel (the ticket threads), never plain
//     DMs, groups or channels.
//  2. createdFrom / createdTo — the created-at time window — behaves like the
//     helpdesk report's range: UTC day bounds, inclusive from, to-day
//     inclusive via an exclusive next-day bound, and correct across BOTH
//     stored timestamp formats (SQLite "YYYY-MM-DD HH:MM:SS" and ISO
//     "YYYY-MM-DDTHH:MM:SSZ") since the column carries mixed formats.
// ─────────────────────────────────────────────────────────────────────────────

const STAMP = Date.now();

async function setCreatedAt(chatId, value) {
  await run("UPDATE chats SET created_at = ? WHERE id = ?", [value, chatId]);
}

describe("adminListChats — type=support filter", () => {
  test("returns only support-channel DM chats (tickets)", async () => {
    const user = { id: await createUser(`adm_chats_filter_u_${STAMP}`, "password123") };

    const supportChatId = await createChat("dm", "dm", { channel: "support" });
    await addChatMember(supportChatId, user.id, "member");

    const directChatId = await createChat("dm", "dm", { channel: "direct" });
    await addChatMember(directChatId, user.id, "member");

    const groupId = await createChat(`Plain Group ${STAMP}`, "group", {});

    const res = await adminListChats({ typeFilter: "support", limit: 500 });
    const chats = res.chats || [];
    const ids = chats.map((c) => String(c.id));

    expect(ids).toContain(String(supportChatId));
    expect(ids).not.toContain(String(directChatId));
    expect(ids).not.toContain(String(groupId));
    for (const chat of chats) {
      expect(chat.type).toBe("dm");
      expect(chat.channel).toBe("support");
    }
  });

  test("type=dm still returns both direct and support DMs", async () => {
    const res = await adminListChats({ typeFilter: "dm", limit: 500 });
    const channels = new Set((res.chats || []).map((c) => c.channel));
    expect(channels.has("support")).toBe(true);
    expect(channels.has("direct")).toBe(true);
  });

  test("every chat row carries an explicit isTicket classification", async () => {
    // Regression (1.5.0-dev.3): the admin panel showed ticket threads as
    // "Direct message" with a second "Ticket" badge, because the stored
    // type stays "dm" and only the channel distinguished tickets. The list
    // must now classify explicitly: support-channel DMs → isTicket: true,
    // messenger DMs / groups / channels → isTicket: false.
    const user = { id: await createUser(`adm_chats_isticket_u_${STAMP}`, "password123") };

    const supportChatId = await createChat("dm", "dm", { channel: "support" });
    await addChatMember(supportChatId, user.id, "member");
    const directChatId = await createChat("dm", "dm", { channel: "direct" });
    await addChatMember(directChatId, user.id, "member");
    const groupId = await createChat(`Plain Group ${STAMP}b`, "group", {});

    const res = await adminListChats({ limit: 500 });
    const chats = res.chats || [];
    const byId = (id) => chats.find((c) => String(c.id) === String(id));

    const ticket = byId(supportChatId);
    expect(ticket.isTicket).toBe(true);
    expect(ticket.type).toBe("dm"); // stored type unchanged
    expect(ticket.channel).toBe("support");

    expect(byId(directChatId).isTicket).toBe(false);
    expect(byId(groupId).isTicket).toBe(false);
  });
});

describe("adminListChats — createdFrom / createdTo window", () => {
  // Distinct day anchors so other rows in the shared test database cannot
  // leak into these windows.
  const DAY_A = "2020-03-15"; // SQLite format row
  const DAY_B = "2021-07-02"; // ISO format row

  let sqliteRowId;
  let isoRowId;

  const fetchWindow = async ({ from, to }) => {
    const res = await adminListChats({ createdFrom: from, createdTo: to, limit: 500 });
    return (res.chats || []).map((c) => String(c.id));
  };

  test("inclusive from + inclusive to across BOTH timestamp formats", async () => {
    sqliteRowId = await createChat(`Window SQLite ${STAMP}`, "group", {});
    await setCreatedAt(sqliteRowId, `${DAY_A} 10:30:00`);

    isoRowId = await createChat(`Window ISO ${STAMP}`, "group", {});
    await setCreatedAt(isoRowId, `${DAY_B}T23:59:59.000Z`);

    // Each day window contains exactly its own row — proves the ISO
    // late-night row is NOT lost to the exclusive next-day bound and the
    // SQLite-format row matches the same predicate.
    const dayA = await fetchWindow({ from: DAY_A, to: DAY_A });
    expect(dayA).toContain(String(sqliteRowId));
    expect(dayA).not.toContain(String(isoRowId));

    const dayB = await fetchWindow({ from: DAY_B, to: DAY_B });
    expect(dayB).toContain(String(isoRowId));
    expect(dayB).not.toContain(String(sqliteRowId));
  });

  test("spanning window contains both; out-of-range windows contain neither", async () => {
    const both = await fetchWindow({ from: DAY_A, to: DAY_B });
    expect(both).toContain(String(sqliteRowId));
    expect(both).toContain(String(isoRowId));

    const before = await fetchWindow({ from: "2019-01-01", to: "2019-12-31" });
    expect(before).not.toContain(String(sqliteRowId));
    expect(before).not.toContain(String(isoRowId));

    const after = await fetchWindow({ from: "2022-01-01", to: "2022-12-31" });
    expect(after).not.toContain(String(sqliteRowId));
    expect(after).not.toContain(String(isoRowId));
  });

  test("no range = no filtering (all chats)", async () => {
    const res = await adminListChats({ limit: 500 });
    const ids = (res.chats || []).map((c) => String(c.id));
    expect(ids).toContain(String(sqliteRowId));
    expect(ids).toContain(String(isoRowId));
  });

  test("combined type=support + date window intersects", async () => {
    const user = { id: await createUser(`adm_chats_filter_u2_${STAMP}`, "password123") };
    const supportInRange = await createChat("dm", "dm", { channel: "support" });
    await addChatMember(supportInRange, user.id, "member");
    await setCreatedAt(supportInRange, `${DAY_A} 09:00:00`);

    const supportOutRange = await createChat("dm", "dm", { channel: "support" });
    await addChatMember(supportOutRange, user.id, "member");
    await setCreatedAt(supportOutRange, `${DAY_B}T12:00:00.000Z`);

    const res = await adminListChats({ typeFilter: "support", createdFrom: DAY_A, createdTo: DAY_A, limit: 500 });
    const ids = (res.chats || []).map((c) => String(c.id));
    expect(ids).toContain(String(supportInRange));
    expect(ids).not.toContain(String(supportOutRange));
  });

  test("persisted rows really carry the two mixed formats", async () => {
    const a = getRow("SELECT created_at FROM chats WHERE id = ?", [sqliteRowId]);
    const b = getRow("SELECT created_at FROM chats WHERE id = ?", [isoRowId]);
    expect(String(a.created_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(String(b.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});
