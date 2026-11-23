// search:doctor — user/group/channel search diagnostics for ChatDesk.
//
// READ-ONLY: never writes to the database and never imports server/db.js
// (importing it would run the full migration bootstrap as a side effect).
// Same discipline as db-doctor.js: connect through db/knex.js directly.
//
// When the "new direct message → search an ID" dialog says "کاربری یافت نشد"
// for everyone, this tool answers WHERE the chain breaks:
//   1. Which engine/database am I actually connected to (encoding/collation)?
//   2. What is REALLY stored in the users table (usernames lower/mixed case,
//      nicknames, banned flags)?
//   3. Does the OLD search SQL (pre 1.2.0-dev.4) match?
//   4. Does the NEW search SQL (lower()-based, dev.4+) match?
//   5. Do the exact usernames/nicknames the admin expects actually exist?
//
// Usage:  npm run search:doctor [probe-term] [probe-term ...]
//         (no terms → probes are derived from the stored usernames)
//
// Exit code 0 always — it is a report, not a gate.
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function line(text = "") {
  console.log(text);
}

function section(title) {
  line();
  line(`── ${title} ${"─".repeat(Math.max(1, 62 - title.length))}`);
}

function isPostgresMode() {
  const client = (
    process.env.DB_CLIENT ||
    (process.env.POSTGRES_URL || process.env.DATABASE_URL ? "postgres" : "sqlite3")
  ).toLowerCase();
  return client === "postgres" || client === "postgresql" || client === "pg";
}

async function main() {
  const probes = process.argv.slice(2).filter(Boolean);

  const knexMod = await import("../db/knex.js");
  const { dbKnex, describePgTarget, getPostgresTimeouts } = knexMod;
  const postgres = isPostgresMode();

  section("Engine & Target");
  if (postgres) {
    const t = describePgTarget();
    line(
      `  PostgreSQL: ${t.host}:${t.port}, database '${t.database}', user '${t.user}'` +
        (t.ssl ? ", SSL required" : ""),
    );
    const timeouts = getPostgresTimeouts();
    if (timeouts) {
      line(`  Timeouts: connect=${timeouts.connectionTimeoutMs}ms statement=${timeouts.statementTimeoutMs}ms`);
    }
    try {
      const enc = await dbKnex.raw("SHOW server_encoding");
      const rows = Array.isArray(enc) ? enc : enc?.rows || [];
      line(`  server_encoding: ${rows[0]?.server_encoding ?? "?"}`);
      const coll = await dbKnex.raw("SHOW lc_collate");
      const collRows = Array.isArray(coll) ? coll : coll?.rows || [];
      line(`  lc_collate: ${collRows[0]?.lc_collate ?? "?"}`);
    } catch (e) {
      line(`  (encoding/collation probe failed: ${String(e?.message || e).split("\n")[0]})`);
    }
  } else {
    line("  SQLite (better-sqlite3, WAL mode)");
    line(`  DATA_DIR: ${process.env.DATA_DIR || "(default)"}`);
  }

  section("Users table");
  let users = [];
  try {
    const res = await dbKnex("users")
      .select("id", "username", "nickname", "role", "banned", "status")
      .orderBy("username", "asc");
    users = Array.isArray(res) ? res : res?.rows || [];
  } catch (e) {
    line(`  [FAIL] cannot read users table: ${String(e?.message || e).split("\n")[0]}`);
    await dbKnex.destroy();
    return;
  }

  line(`  total users: ${users.length}`);
  if (!users.length) {
    line("  [FAIL] the users table is EMPTY — no search can ever match anything.");
    await dbKnex.destroy();
    return;
  }
  for (const u of users.slice(0, 100)) {
    const mixed = u.username !== String(u.username || "").toLowerCase();
    line(
      `    - @${u.username}${mixed ? "  ← MIXED CASE (unfindable by lowercase paths)" : ""}` +
        ` | nickname: ${u.nickname ?? "(none)"}` +
        ` | role: ${u.role || "user"} | banned: ${u.banned ? "YES" : "no"}`,
    );
  }
  if (users.length > 100) {
    line(`    … and ${users.length - 100} more`);
  }
  const mixedCount = users.filter(
    (u) => u.username !== String(u.username || "").toLowerCase(),
  ).length;
  if (mixedCount > 0) {
    line(`  [WARN] ${mixedCount} username(s) contain uppercase characters.`);
    line(`         On PostgreSQL these users can never be found by (or log into)`);
    line(`         the lowercase-based login/search. Normalize them to lowercase.`);
  }

  // Derive default probes from real rows when none were supplied.
  const derived = [];
  const first = users.find((u) => !u.banned) || users[0];
  if (first) {
    derived.push(String(first.username || ""));
    if (first.nickname && String(first.nickname).trim()) {
      derived.push(String(first.nickname).trim());
    }
  }
  const terms = probes.length ? probes : derived;
  if (!terms.length) {
    line("\n  (no probe terms available)");
    await dbKnex.destroy();
    return;
  }

  section("Search SQL probes");
  for (const term of terms) {
    const stripped = String(term).replace(/^@+/, "").toLowerCase();
    const likeOld = `%${String(term).toLowerCase()}%`;
    const likeNew = `%${stripped}%`;

    line(`  probe: "${term}"`);
    try {
      const oldRes = await dbKnex.raw(
        postgres
          ? "select username from users where (username like ? or nickname like ?) order by username asc"
          : "select username from users where (username like ? or nickname like ?) order by username asc",
        [likeOld, likeOld],
      );
      const oldRows = Array.isArray(oldRes) ? oldRes : oldRes?.rows || [];
      line(`    OLD SQL (pre dev.4, raw LIKE)      → ${oldRows.map((r) => r.username).join(", ") || "(nothing matched)"}`);

      const newRes = await dbKnex.raw(
        "select username from users where (lower(username) like ? or lower(nickname) like ?) order by username asc",
        [likeNew, likeNew],
      );
      const newRows = Array.isArray(newRes) ? newRes : newRes?.rows || [];
      line(`    NEW SQL (dev.4+, lower()-based)   → ${newRows.map((r) => r.username).join(", ") || "(nothing matched)"}`);
    } catch (e) {
      line(`    [FAIL] probe failed: ${String(e?.message || e).split("\n")[0]}`);
    }
    line();
  }

  section("How to read this report");
  line("  - OLD SQL empty but NEW SQL finds users  → your server is still running");
  line("    pre-1.2.0-dev.4 code (update did not apply). Check: chatdesk-deploy");
  line("    version + that the install tracks the dev branch.");
  line("  - Both empty for a term you EXPECT to match → look at the Users table");
  line("    above: the account does not exist, is stored differently (mixed case),");
  line("    or is banned.");
  line("  - NEW SQL finds users but the app still says کاربری یافت نشد → the");
  line("    server code is fine; enable APP_DEBUG (admin panel) and retry the");
  line("    search in the app: the log line '[app-debug] api:users:search' shows");
  line("    the exact query and how many rows matched.");

  await dbKnex.destroy();
}

main().catch((error) => {
  console.error(`search:doctor crashed: ${String(error?.message || error)}`);
  process.exit(1);
});
