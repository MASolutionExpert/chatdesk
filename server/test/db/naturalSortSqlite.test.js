import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Natural sort — SQLite regression (Stage 2 HIGH data review #4).
//
// adminListCalls({ sortBy: "chat" }) used to pass the sort direction as
// naturalSortExpr's tiebreaker argument, producing an ORDER BY fragment like
//   "... , DESC COLLATE NOCASE ASC"
// → SQLite error "no such column: DESC" → every chat-sorted admin calls list
// request failed. The direction is now the THIRD argument. This suite also
// pins the SQLite natural-ordering semantics (prefix ASC/DESC + numeric tail)
// that must keep working unchanged, and that the generated clauses stay
// valid for every admin sort key on SQLite.
// ─────────────────────────────────────────────────────────────────────────────

process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-natsort-"));

const {
  createUser,
  createChat,
  addChatMember,
  createMessage,
  adminListUsers,
  adminListChats,
  adminListCalls,
} = await import("../../db.js");

const sync = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

describe("adminListUsers natural sort (SQLite)", () => {
  test("nickname sort orders the numeric tail naturally (User 2 < User 10)", async () => {
    const suffix = Date.now();
    createUser(`ns_a_${suffix}`, "hash", "User 10", null, null);
    createUser(`ns_b_${suffix}`, "hash", "User 2", null, null);

    const res = await sync(
      adminListUsers({ sortBy: "nickname", sortDir: "ASC", limit: 500 }),
    );
    const nicknames = res.users
      .filter((u) => u.nickname === "User 2" || u.nickname === "User 10")
      .map((u) => u.nickname);
    expect(nicknames).toEqual(["User 2", "User 10"]);
  });

  test("DESC reverses the whole natural-sort expression", async () => {
    const suffix = Date.now();
    createUser(`ns_c_${suffix}`, "hash", "Rev 10", null, null);
    createUser(`ns_d_${suffix}`, "hash", "Rev 2", null, null);

    const res = await sync(
      adminListUsers({ sortBy: "nickname", sortDir: "DESC", limit: 500 }),
    );
    const nicknames = res.users
      .filter((u) => u.nickname === "Rev 2" || u.nickname === "Rev 10")
      .map((u) => u.nickname);
    expect(nicknames).toEqual(["Rev 10", "Rev 2"]);
  });
});

describe("adminListChats natural sort (SQLite)", () => {
  test("name sort with trailing numbers and every other sort key stays valid", async () => {
    // NOTE: names must differ ONLY in the trailing number (the natural sort
    // strips trailing digits), so no numeric suffix is appended here.
    const c10 = createChat("Nat Team 10", "group");
    const c2 = createChat("Nat Team 2", "group");

    const res = await sync(
      adminListChats({ sortBy: "name", sortDir: "ASC", limit: 500 }),
    );
    const names = res.chats
      .filter((c) => [c10, c2].includes(c.id))
      .map((c) => c.name);
    expect(names).toEqual(["Nat Team 2", "Nat Team 10"]);

    // These keys previously carried SQLite-only COLLATE NOCASE; on SQLite
    // they must remain valid and non-throwing.
    for (const sortBy of ["type", "group_visibility", "id", "created_at"]) {
      const res = await sync(
        adminListChats({ sortBy, sortDir: "ASC", limit: 10 }),
      );
      expect(res).toBeTruthy();
    }
  });
});

describe("adminListCalls chat sort (SQLite — the F4 repro)", () => {
  test("sortBy 'chat' no longer throws 'no such column: DESC/ASC'", async () => {
    const suffix = Date.now();
    const owner = createUser(`ns_caller_${suffix}`, "hash", "Caller", null, null);
    const chatA = createChat(`Calls Chat A ${suffix}`, "group");
    const chatB = createChat(`Calls Chat B 10 ${suffix}`, "group");
    addChatMember(chatA, owner);
    addChatMember(chatB, owner);
    // Call logs are plaintext system bodies — mirror the callManager path,
    // otherwise storageEncryption ciphertexts them and the LIKE filter fails.
    createMessage(chatA, owner, "[[call:audio:outgoing]]", null, null, null, {
      allowPlaintextSystemMessage: true,
    });
    createMessage(chatB, owner, "[[call:audio:outgoing]]", null, null, null, {
      allowPlaintextSystemMessage: true,
    });

    // Before the fix this exact call threw a SQLite syntax error.
    const resAsc = await sync(
      adminListCalls({ sortBy: "chat", sortDir: "ASC", limit: 500 }),
    );
    expect(resAsc).toBeTruthy();
    const ascNames = resAsc.calls
      .filter((c) => [chatA, chatB].includes(c.chat_id))
      .map((c) => c.chat_name);
    expect(ascNames).toEqual(
      [`Calls Chat A ${suffix}`, `Calls Chat B 10 ${suffix}`].sort(),
    );

    const resDesc = await sync(
      adminListCalls({ sortBy: "chat", sortDir: "DESC", limit: 500 }),
    );
    expect(resDesc).toBeTruthy();
    const descNames = resDesc.calls
      .filter((c) => [chatA, chatB].includes(c.chat_id))
      .map((c) => c.chat_name);
    expect(descNames).toEqual(
      [`Calls Chat A ${suffix}`, `Calls Chat B 10 ${suffix}`].sort().reverse(),
    );
  });

  test("sortBy 'caller' stays valid on SQLite (COLLATE NOCASE branch)", async () => {
    const res = await sync(
      adminListCalls({ sortBy: "caller", sortDir: "DESC", limit: 50 }),
    );
    expect(res).toBeTruthy();
  });
});
