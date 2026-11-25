import { describe, expect, test, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import knex from "knex";

// ─────────────────────────────────────────────────────────────────────────────
// listStaffReferCandidates — referral picker directory query.
//
// Regression suites for the 1.5.0-dev.9 production outage: the picker called
// GET /api/support/tickets/:chatId/refer-candidates and got HTTP 500 on every
// PostgreSQL deployment, so the dialog never showed a single operator or
// department ("no operators" / "Request failed (500)").
//
// Root cause: the ORDER BY clause referenced the `last_interaction` output
// ALIAS inside an expression ("(last_interaction IS NULL) ASC"). SQLite
// resolves aliases inside ORDER BY expressions — so every unit test stayed
// green — but PostgreSQL requires an output column name to STAND ALONE in
// ORDER BY and raised `column "last_interaction" does not exist`.
//
// These suites pin BOTH layers:
//   * dialect  : compile the exported builder with a pg knex client and
//                assert the ORDER BY never references the alias (only the
//                inlined correlated subquery — valid on both engines)
//   * behavior : run the real query against a migrated SQLite database and
//                assert the directory content + recent-contact ordering
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; the functional suite is
// SQLite-only by design.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-refer-cand-"));

const {
  createUser,
  createChat,
  addChatMember,
  createDepartment,
  setUserDepartment,
  setUserBanned,
  createMessage,
  listStaffReferCandidates,
  buildStaffReferCandidatesQuery,
} = await import("../../db.js");

const sync = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

describe("buildStaffReferCandidatesQuery — PostgreSQL dialect regression", () => {
  const pg = knex({ client: "pg" });
  afterAll(async () => {
    await pg.destroy();
  });

  test("ORDER BY never references the last_interaction alias", () => {
    const compiled = buildStaffReferCandidatesQuery(pg, {
      actorUserId: "actor-uuid",
    }).toSQL();
    const orderIdx = compiled.sql.toLowerCase().lastIndexOf("order by");
    expect(orderIdx).toBeGreaterThan(-1);
    const orderClause = compiled.sql.slice(orderIdx);

    // The 1.5.0-dev.9 bug, verbatim: "(last_interaction IS NULL) ASC, ..."
    // — PostgreSQL: ERROR: column "last_interaction" does not exist.
    expect(orderClause).not.toMatch(/last_interaction/);

    // The correlated subquery is inlined instead — valid on pg AND sqlite.
    expect(orderClause).toContain("MAX(m.created_at)");
    expect(orderClause).toContain("IS NULL ASC");
    expect(orderClause).toContain("DESC");
  });

  test("SELECT list keeps the last_interaction alias for normalization", () => {
    const compiled = buildStaffReferCandidatesQuery(pg, {
      actorUserId: "actor-uuid",
    }).toSQL();
    expect(compiled.sql).toMatch(/AS last_interaction/i);
    expect(compiled.sql).toMatch(/department_name/i);
  });

  test("actor binding appears once in SELECT and twice in ORDER BY", () => {
    const compiled = buildStaffReferCandidatesQuery(pg, {
      actorUserId: "actor-uuid",
      excludeUserIds: ["other-uuid"],
    }).toSQL();
    const actorBindings = compiled.bindings.filter(
      (b) => b === "actor-uuid",
    );
    expect(actorBindings).toHaveLength(3);
    expect(compiled.bindings).toContain("other-uuid");
  });
});

describe("listStaffReferCandidates — real SQLite scan", () => {
  const stamp = Date.now();
  const ownerId = createUser(`refer_owner_${stamp}`, "hash", "Owner", null, null, {
    role: "owner",
  });
  const opRecentId = createUser(`refer_op_recent_${stamp}`, "hash", "Op Recent", null, null, {
    role: "operator",
  });
  const opFreshId = createUser(`refer_op_fresh_${stamp}`, "hash", "Op Fresh", null, null, {
    role: "operator",
  });
  const opBannedId = createUser(`refer_op_banned_${stamp}`, "hash", "Op Banned", null, null, {
    role: "operator",
  });
  const customerId = createUser(`refer_cust_${stamp}`, "hash", "Customer", null, null, {
    role: "user",
  });

  beforeAll(async () => {
    const dept = await sync(createDepartment({ name: `Billing ${stamp}` }));
    await sync(setUserDepartment(opRecentId, dept.id));

    await sync(setUserBanned(opBannedId, true));

    // A shared chat between the owner (actor) and opRecent — gives that
    // operator a last_interaction timestamp; opFresh stays untouched.
    const chatId = await sync(createChat(null, "dm"));
    await sync(addChatMember(chatId, ownerId, "owner"));
    await sync(addChatMember(chatId, opRecentId, "member"));
    await sync(createMessage(chatId, opRecentId, "hi from the recent operator"));
  });

  test("returns the full unbanned staff directory except the actor", async () => {
    const candidates = await sync(
      listStaffReferCandidates({ actorUserId: ownerId, excludeUserIds: [ownerId] }),
    );
    const usernames = candidates.map((c) => c.username);
    expect(usernames).toContain(`refer_op_recent_${stamp}`);
    expect(usernames).toContain(`refer_op_fresh_${stamp}`);
    expect(usernames).not.toContain(`refer_owner_${stamp}`);
    expect(usernames).not.toContain(`refer_op_banned_${stamp}`);
    expect(usernames).not.toContain(`refer_cust_${stamp}`);

    const recent = candidates.find(
      (c) => c.username === `refer_op_recent_${stamp}`,
    );
    expect(recent.role).toBe("operator");
    expect(recent.departmentName).toContain("Billing");
    expect(recent.lastInteraction).toBeTruthy();

    const fresh = candidates.find(
      (c) => c.username === `refer_op_fresh_${stamp}`,
    );
    expect(fresh.departmentName ?? null).toBeNull();
    expect(fresh.lastInteraction ?? null).toBeNull();
  });

  test("recent contacts sort before never-talked-to staff", async () => {
    const candidates = await sync(
      listStaffReferCandidates({ actorUserId: ownerId, excludeUserIds: [ownerId] }),
    );
    const order = candidates.map((c) => c.username);
    expect(order.indexOf(`refer_op_recent_${stamp}`)).toBeLessThan(
      order.indexOf(`refer_op_fresh_${stamp}`),
    );
  });
});
