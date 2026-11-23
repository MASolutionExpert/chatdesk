/**
 * Migration 045: Tickets — the ticket domain table.
 *
 * ChatDesk carries two strictly separated message domains:
 *
 *   - Messenger (direct): user↔user and staff↔staff conversations opened by
 *     finding a user's ID (`chats.channel = 'direct'`). No ticket identity.
 *   - Tickets (support): customer→department→fair-routed-operator helpdesk
 *     threads (`chats.channel = 'support'`, `chats.department_id` set).
 *
 * Until now a "ticket" was only a tagged chat row. This migration gives the
 * ticket its own table — one ticket per support chat, 1:1 — so the ticket
 * domain owns its identity and lifecycle explicitly:
 *
 *   - which customer opened it, against which department, assigned to which
 *     operator (fixed at assignment — re-routing means a new request);
 *   - `status` ('open' | 'closed') with `closed_at`, replacing the old
 *     "customer-replied-last = open" heuristic for fair routing and reports.
 *
 * Messages themselves stay in `chat_messages` (one storage pipeline powers
 * files, calls, reads, SSE and push for BOTH domains — splitting it would
 * break the messenger features support threads legitimately use). The
 * separation is enforced logically: `chats.channel` partitions the two
 * domains, `POST /api/chats/dm` refuses cross-boundary threads
 * (customer↔staff), and `POST /api/support/request` never touches direct
 * chats. The `tickets` table is the ticket domain's own registry.
 *
 * Backfill: every existing support chat gets one open ticket row so fair
 * routing and the admin overview work identically after upgrade. Chats that
 * are support-tagged but have no department (should not exist) are skipped —
 * the app treats a support chat without a ticket row as open.
 *
 * Idempotency: CREATE TABLE IF NOT EXISTS + guarded backfill; safe to re-run.
 */
export const migration045Tickets = {
  version: 45,
  up: ({ db, getAll, tableExists }) => {
    if (!tableExists("tickets")) {
      db.run(`
        CREATE TABLE IF NOT EXISTS tickets (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL UNIQUE,
          department_id INTEGER NOT NULL,
          customer_id TEXT NOT NULL,
          operator_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          closed_at TEXT
        )
      `);
    }
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_tickets_department_status ON tickets(department_id, status)",
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_tickets_operator ON tickets(operator_id)");

    if (!tableExists("chats")) return;

    // Backfill one ticket per support chat that has a department. Customer =
    // the chat member with users.role = 'user' (fallback: earliest member);
    // operator = the member with a support role. Missing either side → skip
    // (the app falls back to treating such chats as open).
    const supportChats = getAll(`
      SELECT c.id AS chat_id,
             c.department_id,
             c.created_at,
             (SELECT m.user_id FROM chat_members m
               JOIN users u ON u.id = m.user_id
               WHERE m.chat_id = c.id AND u.role = 'user'
               ORDER BY m.user_id LIMIT 1) AS customer_id,
             (SELECT m.user_id FROM chat_members m
               JOIN users u ON u.id = m.user_id
               WHERE m.chat_id = c.id
                 AND u.role IN ('operator','admin','owner')
               ORDER BY m.user_id LIMIT 1) AS operator_id
      FROM chats c
      WHERE c.type = 'dm'
        AND c.channel = 'support'
        AND c.department_id IS NOT NULL
    `);
    const existing = getAll("SELECT chat_id FROM tickets");
    const existingChatIds = new Set((existing || []).map((r) => String(r.chat_id)));

    const isThenable = (v) => v && typeof v.then === "function";
    for (const row of supportChats || []) {
      if (!row || !row.chat_id || existingChatIds.has(String(row.chat_id))) continue;
      if (!row.customer_id || !row.operator_id || !row.department_id) continue;
      const id = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const res = db.run(
        `INSERT INTO tickets (id, chat_id, department_id, customer_id, operator_id, status, created_at, closed_at)
         VALUES (?, ?, ?, ?, ?, 'open', COALESCE(?, datetime('now')), NULL)`,
        [
          String(id),
          String(row.chat_id),
          Number(row.department_id),
          String(row.customer_id),
          String(row.operator_id),
          row.created_at || null,
        ],
      );
      if (isThenable(res)) {
        // Postgres mode: db.run queues onto the migration promise chain, so
        // ordering is preserved without awaiting here.
      }
    }
  },
};
