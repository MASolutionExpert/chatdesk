import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// User / group / channel search hardening.
//
// Two production realities that broke the "new direct message → search an ID"
// flow with a literal "کاربری یافت نشد" (no users found) for every lookup:
//
//   1. Users habitually type an "@" prefix ("@bob"). The old LIKE pattern
//      "%@bob%" matched nothing — every ID search returned an empty list.
//   2. PostgreSQL's LIKE is case-sensitive (SQLite's is not), so on Postgres
//      deployments a mixed-case nickname ("Alice") or group name ("Support
//      Team") was unfindable with a lowercase query.
//
// Fix contract (searchUsers / searchPublicGroups / searchPublicChannels):
//   - leading "@" characters are stripped from the term
//   - comparisons run through lower() on both engines
//   - a term that is empty after stripping matches nothing (never the whole
//     table)
// ─────────────────────────────────────────────────────────────────────────────

process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-usersearch-"));

const {
  createUser,
  createChat,
  addChatMember,
  searchUsers,
  searchPublicGroups,
  searchPublicChannels,
} = await import("../../db.js");

const sync = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

describe("searchUsers", () => {
  const aliceId = createUser("alice", "hash", "Alice Cooper", null, null, { role: "user" });
  const bobId = createUser("bob", "hash", "Bob", null, null, { role: "user" });

  test("finds a user by exact username", async () => {
    const rows = await sync(searchUsers("bob", "alice"));
    expect(rows.map((r) => r.username)).toEqual(["bob"]);
  });

  test("finds a user when the query carries an '@' prefix", async () => {
    const rows = await sync(searchUsers("@bob", "alice"));
    expect(rows.map((r) => r.username)).toEqual(["bob"]);
  });

  test("multiple '@' prefixes are all stripped", async () => {
    const rows = await sync(searchUsers("@@bob", "alice"));
    expect(rows.map((r) => r.username)).toEqual(["bob"]);
  });

  test("query case does not matter (username)", async () => {
    const rows = await sync(searchUsers("BOB", "alice"));
    expect(rows.map((r) => r.username)).toEqual(["bob"]);
  });

  test("query case does not matter (mixed-case nickname)", async () => {
    const rows = await sync(searchUsers("alice cooper", "bob"));
    expect(rows.map((r) => r.username)).toEqual(["alice"]);
  });

  test("partial nickname match is case-insensitive", async () => {
    const rows = await sync(searchUsers("ALICE", "bob"));
    expect(rows.map((r) => r.username)).toEqual(["alice"]);
  });

  test("a term that is empty after stripping matches nothing", async () => {
    expect(await sync(searchUsers("@", "alice"))).toEqual([]);
    expect(await sync(searchUsers("   ", "alice"))).toEqual([]);
    expect(await sync(searchUsers("", "alice"))).toEqual([]);
  });

  test("excluded username is never returned", async () => {
    const rows = await sync(searchUsers("b", "alice"));
    expect(rows.some((r) => r.username === "alice")).toBe(false);
    expect(rows.some((r) => r.username === "bob")).toBe(true);
  });

  test("created user ids are valid", () => {
    expect(aliceId).toBeTruthy();
    expect(bobId).toBeTruthy();
  });
});

describe("searchPublicGroups / searchPublicChannels", () => {
  const viewerId = createUser("viewer", "hash", "Viewer", null, null, { role: "user" });

  test("finds a public group with a mixed-case name, lowercase query", async () => {
    const chatId = await sync(
      createChat("Support Team", "group", { groupUsername: "support-team" }),
    );
    const rows = await sync(searchPublicGroups("support team", viewerId, 20));
    expect(rows.some((r) => r.id === chatId)).toBe(true);
  });

  test("finds a group searched with an '@' prefix", async () => {
    const rows = await sync(searchPublicGroups("@support", viewerId, 20));
    expect(rows.length).toBeGreaterThan(0);
  });

  test("group query case does not matter", async () => {
    const rows = await sync(searchPublicGroups("SUPPORT TEAM", viewerId, 20));
    expect(rows.length).toBeGreaterThan(0);
  });

  test("empty-after-stripping group term matches nothing", async () => {
    expect(await sync(searchPublicGroups("@", viewerId, 20))).toEqual([]);
  });

  test("finds a public channel with a mixed-case name, lowercase query", async () => {
    const chatId = await sync(
      createChat("News Channel", "channel", { groupUsername: "news" }),
    );
    const rows = await sync(searchPublicChannels("news channel", viewerId, 20));
    expect(rows.some((r) => r.id === chatId)).toBe(true);
  });

  test("channel searched with an '@' prefix is found", async () => {
    const rows = await sync(searchPublicChannels("@news", viewerId, 20));
    expect(rows.length).toBeGreaterThan(0);
  });

  test("empty-after-stripping channel term matches nothing", async () => {
    expect(await sync(searchPublicChannels("@", viewerId, 20))).toEqual([]);
  });

  test("setup sanity: viewer and membership helpers exist", async () => {
    // addChatMember is imported to prove the wiring stays intact for member
    // visibility branches of the search functions.
    expect(typeof addChatMember).toBe("function");
    expect(viewerId).toBeTruthy();
  });
});
