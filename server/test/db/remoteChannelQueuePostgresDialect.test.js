import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dbKnex } from "../../db/knex.js";

// ─────────────────────────────────────────────────────────────────────────────
// Postgres dialect branches for the remote-channel queue (Stage 2 HIGH data
// review #2 + #6) and the admin natural-sort helpers (HIGH data review #4+#5).
//
// These behaviours cannot be integration-tested here (SQLite-only sandbox),
// so the SQL generation is pinned instead, using the established pattern of
// DB_CLIENT=postgres + a mocked dbKnex.raw:
//  - claim/release/purge must NOT contain julianday() (the sqlNormalizer
//    would strip it and leave a broken session-TZ TEXT compare); both sides
//    of every timestamp compare must be cast to ::timestamptz.
//  - claim must return null when the claim UPDATE reports rowCount 0
//    (the fix for the double-mirroring race).
//  - the admin list ORDER BY must not contain the SQLite-only
//    "COLLATE NOCASE" and must not pass the sort dir as naturalSortExpr's
//    tiebreaker argument.
// ─────────────────────────────────────────────────────────────────────────────

// Load db.js in SQLite mode FIRST (isolated DATA_DIR) so its import-time
// migrations run against SQLite; the tests then flip isPostgresMode() via
// DB_CLIENT at runtime — the same approach as remoteChannelPostgresFixes.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-queue-pg-"));

const db = await import("../../db.js");

let originalDbClient;

beforeEach(() => {
  originalDbClient = process.env.DB_CLIENT;
  process.env.DB_CLIENT = "postgres";
});

afterEach(() => {
  if (originalDbClient !== undefined) {
    process.env.DB_CLIENT = originalDbClient;
  } else {
    delete process.env.DB_CLIENT;
  }
  vi.restoreAllMocks();
});

const sqlOf = (mock, matcher) =>
  mock.mock.calls
    .map((args) => String(args[0] || ""))
    .filter((sql) => (matcher ? matcher.test(sql) : true));

describe("remote-channel queue — Postgres dialect (claim / release / purge)", () => {
  test("claim uses timestamptz compares (no julianday) and returns null when the UPDATE claims 0 rows", async () => {
    const raw = vi
      .spyOn(dbKnex, "raw")
      .mockImplementation(async (sql) => {
        const lower = String(sql || "").toLowerCase();
        if (lower.startsWith("select")) {
          return { rows: [{ id: 42, source_id: 5, status: "pending" }], rowCount: 1 };
        }
        // UPDATE remote_channel_queue ... → claim lost the race.
        return { rows: [], rowCount: 0 };
      });

    const claimed = await db.claimNextRemoteChannelQueueItem("worker-a");

    // THE FIX: the row was claimed by another instance (0 rows updated) —
    // the stale SELECT snapshot must NOT be returned.
    expect(claimed).toBeNull();

    const selectSql = sqlOf(raw, /^select/i).join("\n");
    expect(selectSql).not.toMatch(/julianday/i);
    expect(selectSql).toContain("::timestamptz");
    expect(selectSql).toContain("NULLIF(q.next_attempt_at, '')::timestamptz <= ");
    expect(selectSql).toContain("ORDER BY NULLIF(q.created_at, '')::timestamptz ASC");
  });

  test("claim returns the item when the UPDATE reports affected rows", async () => {
    vi.spyOn(dbKnex, "raw").mockImplementation(async (sql) => {
      const lower = String(sql || "").toLowerCase();
      if (lower.startsWith("select")) {
        return { rows: [{ id: 42, source_id: 5, status: "pending" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const claimed = await db.claimNextRemoteChannelQueueItem("worker-a");
    expect(claimed).toBeTruthy();
    expect(Number(claimed.id)).toBe(42);
    expect(claimed.status).toBe("processing");
    expect(claimed.lock_owner).toBe("worker-a");
  });

  test("releaseStale uses a timestamptz compare (no julianday)", async () => {
    const raw = vi.spyOn(dbKnex, "raw").mockResolvedValue({ rows: [], rowCount: 1 });

    db.releaseStaleRemoteChannelQueueItems("2026-07-15T10:00:00.000Z");

    expect(raw).toHaveBeenCalled();
    const sql = sqlOf(raw, /update remote_channel_queue/i).join("\n");
    expect(sql).not.toMatch(/julianday/i);
    expect(sql).toContain("NULLIF(locked_at, '')::timestamptz <= ?::timestamptz");
  });

  test("purge uses a timestamptz compare (no julianday)", async () => {
    const raw = vi.spyOn(dbKnex, "raw").mockResolvedValue({ rows: [], rowCount: 1 });

    db.purgeOldRemoteChannelQueueItems("2026-07-15T10:00:00.000Z");

    const sql = sqlOf(raw, /delete from remote_channel_queue/i).join("\n");
    expect(sql).not.toMatch(/julianday/i);
    expect(sql).toContain("NULLIF(processed_at, '')::timestamptz < ?::timestamptz");
  });
});

describe("admin list ordering — Postgres natural sort (no SQLite-only SQL)", () => {
  const mockListResult = () =>
    vi.spyOn(dbKnex, "raw").mockResolvedValue({
      rows: [{ _total: 0 }],
      rowCount: 1,
    });

  test("adminListUsers by nickname/username: LOWER(...) ordering, no COLLATE NOCASE", async () => {
    const raw = mockListResult();

    await db.adminListUsers({ sortBy: "nickname", sortDir: "ASC" });
    const nicknameSql = sqlOf(raw, /order by/i).join("\n");
    expect(nicknameSql).not.toMatch(/collate nocase/i);
    expect(nicknameSql).toContain("LOWER(RTRIM(nickname,'0123456789')) ASC");
    expect(nicknameSql).toContain("::bigint");
    expect(nicknameSql).toContain("LOWER(username) ASC");

    await db.adminListUsers({ sortBy: "username", sortDir: "DESC" });
    const usernameSql = sqlOf(raw, /order by/i).join("\n");
    expect(usernameSql).not.toMatch(/collate nocase/i);
    expect(usernameSql).toContain("LOWER(RTRIM(username,'0123456789')) DESC");
    expect(usernameSql).toContain("LOWER(nickname) DESC");
  });

  test("adminListChats by name/type/group_visibility: valid on Postgres", async () => {
    const raw = mockListResult();

    await db.adminListChats({ sortBy: "name", sortDir: "ASC" });
    const nameSql = sqlOf(raw, /order by/i).join("\n");
    expect(nameSql).not.toMatch(/collate nocase/i);
    expect(nameSql).toContain("LOWER(RTRIM(c.name,'0123456789')) ASC");
    expect(nameSql).toContain("LOWER(c.group_username) ASC");

    await db.adminListChats({ sortBy: "type", sortDir: "DESC" });
    const typeSql = sqlOf(raw, /order by/i).join("\n");
    expect(typeSql).toContain("LOWER(c.type) DESC");

    await db.adminListChats({ sortBy: "group_visibility", sortDir: "ASC" });
    const visSql = sqlOf(raw, /order by/i).join("\n");
    expect(visSql).toContain("LOWER(c.group_visibility) ASC");
  });

  test("adminListCalls by caller/chat: valid on Postgres; dir is the 3rd naturalSortExpr arg", async () => {
    const raw = mockListResult();

    await db.adminListCalls({ sortBy: "caller", sortDir: "ASC" });
    const callerSql = sqlOf(raw, /order by/i).join("\n");
    expect(callerSql).not.toMatch(/collate nocase/i);
    expect(callerSql).toContain("LOWER(cu.username) ASC");

    // The review's F4 repro: the chat sort used to pass the sort dir as the
    // tiebreaker → "... DESC COLLATE NOCASE ASC" → invalid SQL. The generated
    // clause must contain a valid natural-sort expression and never a bare
    // direction token used as a column.
    await db.adminListCalls({ sortBy: "chat", sortDir: "DESC" });
    const chatSql = sqlOf(raw, /order by/i).join("\n");
    expect(chatSql).not.toMatch(/collate nocase/i);
    expect(chatSql).toContain("LOWER(RTRIM(c.name,'0123456789')) DESC");
    // Both natural-sort terms carry the dir; no bare direction token is
    // interpreted as a column (the old bug), and the numeric tail casts via
    // NULLIF->bigint instead of SQLite's CAST('' AS INTEGER).
    expect(chatSql).toContain("')::bigint, 0) DESC");
    expect(chatSql).not.toMatch(/,\s*(ASC|DESC)\s+COLLATE/i);
  });
});
