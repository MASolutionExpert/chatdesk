// Stage 4 (LOW) security fixes — Task 4-a db-level tests:
//   3. getMessages opts-in afterIdExclusive: `id > anchor` instead of the
//      inclusive default (pollers must not re-receive the anchor message).
//   7a. updateGroupChat preserves group_visibility when the field is omitted.

import { describe, test, expect } from "vitest";
import {
  getMessages,
  createMessage,
  createChat,
  createUser,
  updateGroupChat,
  getRow,
} from "../db.js";

const asAwaitable = async (value) =>
  value && typeof value.then === "function" ? await value : value;

describe("getMessages afterIdExclusive (low4a)", () => {
  test("default anchor stays inclusive (returns the anchor message)", async () => {
    const userId = createUser(`low4a_incl_${Date.now()}`, "hash", "Nick", null, "#10b981");
    const chatId = await asAwaitable(createChat("Low4a Inclusive Chat", "dm"));

    const msg1Id = createMessage(chatId, userId, "anchor");
    await new Promise((r) => setTimeout(r, 1100));
    const msg2Id = createMessage(chatId, userId, "newer");

    const all = await asAwaitable(getMessages(chatId));
    const msg1 = all.messages.find((m) => m.id === msg1Id);
    const msg2 = all.messages.find((m) => m.id === msg2Id);
    expect(msg1).toBeDefined();
    expect(msg2).toBeDefined();

    const res = await asAwaitable(
      getMessages(chatId, {
        afterId: msg1.id,
        afterCreatedAt: new Date(msg1.created_at).toISOString(),
      }),
    );
    const ids = res.messages.map((m) => m.id);
    expect(ids).toContain(msg1Id); // inclusive default
    expect(ids).toContain(msg2Id);
  });

  test("afterIdExclusive returns only messages strictly newer than the anchor", async () => {
    const userId = createUser(`low4a_excl_${Date.now()}`, "hash", "Nick", null, "#10b981");
    const chatId = await asAwaitable(createChat("Low4a Exclusive Chat", "dm"));

    const msg1Id = createMessage(chatId, userId, "anchor");
    await new Promise((r) => setTimeout(r, 1100));
    const msg2Id = createMessage(chatId, userId, "newer 1");
    const msg3Id = createMessage(chatId, userId, "newer 2");

    const all = await asAwaitable(getMessages(chatId));
    const msg1 = all.messages.find((m) => m.id === msg1Id);
    expect(msg1).toBeDefined();

    const res = await asAwaitable(
      getMessages(chatId, {
        afterId: msg1.id,
        afterCreatedAt: new Date(msg1.created_at).toISOString(),
        afterIdExclusive: true,
      }),
    );
    const ids = res.messages.map((m) => m.id);
    expect(ids).not.toContain(msg1Id); // anchor excluded
    expect(ids).toContain(msg2Id);
    expect(ids).toContain(msg3Id);
    expect(ids.length).toBe(2);
  });

  test("poller passing the last seen id with limit=1 never receives it again", async () => {
    const userId = createUser(`low4a_poll_${Date.now()}`, "hash", "Nick", null, "#10b981");
    const chatId = await asAwaitable(createChat("Low4a Poll Chat", "dm"));

    const msg1Id = createMessage(chatId, userId, "seen");
    await new Promise((r) => setTimeout(r, 1100));
    const msg2Id = createMessage(chatId, userId, "fresh");

    const all = await asAwaitable(getMessages(chatId));
    const msg1 = all.messages.find((m) => m.id === msg1Id);

    const res = await asAwaitable(
      getMessages(chatId, {
        afterId: msg1.id,
        afterCreatedAt: new Date(msg1.created_at).toISOString(),
        afterIdExclusive: true,
        limit: 1,
      }),
    );
    expect(res.messages.map((m) => m.id)).toEqual([msg2Id]);
    expect(res.hasMore).toBe(false);
  });
});

describe("updateGroupChat preserves omitted group_visibility (low4a)", () => {
  test("omitting groupVisibility keeps the existing private visibility", async () => {
    const ownerName = `low4a_vis_owner_${Date.now()}`;
    const ownerId = createUser(ownerName, "hash", "Nick", null, "#10b981");
    const chatId = await asAwaitable(
      createChat("Low4a Private Group", "group", {
        groupVisibility: "private",
      }),
    );
    // Ensure membership row exists (createChat may add creator automatically).
    void ownerId;

    await asAwaitable(
      updateGroupChat(chatId, { name: "Renamed — visibility untouched" }),
    );

    const chat = getRow("SELECT * FROM chats WHERE id = ?", [chatId]);
    expect(chat.group_visibility).toBe("private");
  });

  test("omitting groupVisibility keeps the existing public visibility", async () => {
    createUser(`low4a_vis_pub_${Date.now()}`, "hash", "Nick", null, "#10b981");
    const chatId = await asAwaitable(
      createChat("Low4a Public Group", "group", { groupVisibility: "public" }),
    );

    await asAwaitable(
      updateGroupChat(chatId, { name: "Renamed Public Group" }),
    );

    const chat = getRow("SELECT * FROM chats WHERE id = ?", [chatId]);
    expect(chat.group_visibility).toBe("public");
  });

  test("explicitly provided groupVisibility still updates (and private forces auto_add off)", async () => {
    createUser(`low4a_vis_set_${Date.now()}`, "hash", "Nick", null, "#10b981");
    const chatId = await asAwaitable(
      createChat("Low4a Switch Group", "group", {
        groupVisibility: "public",
        autoAddNewUsers: true,
      }),
    );

    await asAwaitable(
      updateGroupChat(chatId, { groupVisibility: "private" }),
    );

    const chat = getRow("SELECT * FROM chats WHERE id = ?", [chatId]);
    expect(chat.group_visibility).toBe("private");
    expect(chat.auto_add_new_users).toBe(0);
  });
});
