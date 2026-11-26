import { describe, expect, test } from "vitest";
import { migration045Tickets } from "../../migrations/045-tickets.js";

/**
 * Regression test for the v1.3.0-dev.8 production incident:
 *   "(existing || []).map is not a function"
 *
 * In Postgres mode the migration context queues every query onto
 * `migrationPromiseChain`, so `getAll` and `db.run` return PROMISES, not row
 * arrays / sync results. Migration 045's original `up` was synchronous and
 * treated the getAll result as an array — it worked in SQLite mode and in the
 * stubbed CI tests, but crashed on the real Postgres server before version 45
 * was recorded. The runner supports `async up`; the migration must await
 * every context call in BOTH driver modes.
 */

const SUPPORT_CHAT_ROWS = [
  {
    chat_id: "chat-1",
    department_id: 3,
    created_at: "2026-11-20 10:00:00",
    customer_id: "u-cust",
    operator_id: "u-op",
  },
  {
    chat_id: "chat-2",
    department_id: 3,
    created_at: "2026-11-21 11:00:00",
    customer_id: "u-cust2",
    operator_id: "u-op",
  },
];

function makeCtx({ thenable, supportRows, existingTicketRows, tables }) {
  const inserts = [];
  const tableSet = new Set(tables);
  const arrayGetAll = (sql) => {
    if (/FROM chats/i.test(sql)) return supportRows;
    if (/FROM tickets/i.test(sql)) return existingTicketRows;
    return [];
  };
  return {
    ctx: {
      isPostgres: thenable,
      tableExists: (t) => tableSet.has(String(t)),
      getAll: (sql) =>
        thenable ? Promise.resolve(arrayGetAll(sql)) : arrayGetAll(sql),
      db: {
        run: (sql, params = []) => {
          if (/INSERT INTO tickets/i.test(sql)) {
            inserts.push({ sql, params });
          }
          return thenable ? Promise.resolve(1) : 1;
        },
      },
    },
    inserts,
  };
}

const BASE_TABLES = ["chats", "tickets"];

describe("migration 045 tickets backfill — async context contract", () => {
  test("Postgres mode: awaits thenable getAll/db.run (production crash repro)", async () => {
    const { ctx, inserts } = makeCtx({
      thenable: true,
      supportRows: SUPPORT_CHAT_ROWS,
      existingTicketRows: [],
      tables: BASE_TABLES,
    });
    // Before the fix this threw synchronously:
    //   TypeError: (existing || []).map is not a function
    // because `existing` was a Promise, and the error escaped `await up(...)`.
    await expect(migration045Tickets.up(ctx)).resolves.toBeUndefined();
    expect(inserts).toHaveLength(SUPPORT_CHAT_ROWS.length);
    const insertedChatIds = inserts.map((i) => i.params[1]);
    expect(insertedChatIds.sort()).toEqual(["chat-1", "chat-2"]);
    // lifecycle fields: 6 placeholders = [id, chat_id, dept, customer, operator, created_at]
    for (const row of inserts) {
      expect(/'open'/.test(row.sql)).toBe(true); // status literal
      expect(/, NULL\)/.test(row.sql)).toBe(true); // closed_at literal
      expect(SUPPORT_CHAT_ROWS.some((c) => c.created_at === row.params[5])).toBe(
        true,
      ); // created_at from the chat
    }
  });

  test("Postgres mode: insert errors propagate to the runner", async () => {
    const { ctx } = makeCtx({
      thenable: true,
      supportRows: SUPPORT_CHAT_ROWS,
      existingTicketRows: [],
      tables: BASE_TABLES,
    });
    ctx.db.run = (sql) =>
      /INSERT INTO tickets/i.test(sql)
        ? Promise.reject(new Error("pg: duplicate key"))
        : Promise.resolve(1);
    await expect(migration045Tickets.up(ctx)).rejects.toThrow(/duplicate key/);
  });

  test("Postgres mode: guarded backfill — existing ticket chat ids are skipped", async () => {
    const { ctx, inserts } = makeCtx({
      thenable: true,
      supportRows: SUPPORT_CHAT_ROWS,
      existingTicketRows: [{ chat_id: "chat-1" }],
      tables: BASE_TABLES,
    });
    await migration045Tickets.up(ctx);
    // Only the missing one is backfilled — safe to re-run after a partial run
    // (the user's server hit the crash AFTER CREATE TABLE: tickets existed
    // empty, schema stayed at v44; the re-run must fill it idempotently).
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[1]).toBe("chat-2");
  });

  test("Postgres mode: incomplete support chats (no customer/operator/department) are skipped", async () => {
    const { ctx, inserts } = makeCtx({
      thenable: true,
      supportRows: [
        { chat_id: "chat-1", department_id: 3, customer_id: null, operator_id: "u-op" },
        { chat_id: "chat-2", department_id: 3, customer_id: "u-cust", operator_id: null },
        { chat_id: "chat-3", department_id: null, customer_id: "u-cust", operator_id: "u-op" },
      ],
      existingTicketRows: [],
      tables: BASE_TABLES,
    });
    await migration045Tickets.up(ctx);
    expect(inserts).toHaveLength(0);
  });

  test("SQLite mode: sync getAll/db.run results still work (await on plain values)", async () => {
    const { ctx, inserts } = makeCtx({
      thenable: false,
      supportRows: SUPPORT_CHAT_ROWS,
      existingTicketRows: [],
      tables: BASE_TABLES,
    });
    await expect(migration045Tickets.up(ctx)).resolves.toBeUndefined();
    expect(inserts).toHaveLength(2);
  });

  test("no chats table: DDL only, no backfill", async () => {
    const { ctx, inserts } = makeCtx({
      thenable: true,
      supportRows: [],
      existingTicketRows: [],
      tables: ["tickets"], // chats missing
    });
    await migration045Tickets.up(ctx);
    expect(inserts).toHaveLength(0);
  });
});
