/**
 * Migration 044: Chat channel types (direct vs support).
 *
 * ChatDesk carries two distinct kinds of DM conversations that must stay
 * separate and visually distinguishable everywhere:
 *
 *   - `direct`  : messenger-style chats (user↔operator by ID lookup,
 *                 operator↔operator, group DMs) — no department attachment.
 *   - `support` : helpdesk threads created through the department picker
 *                 ("tickets"), always attached to `chats.department_id`.
 *
 * The explicit `channel` column is the source of truth for badges, admin
 * filters and routing; `department_id` stays as the department reference.
 * Every existing chat defaults to `direct` (pre-support history was by
 * definition messenger-style).
 *
 * Idempotency: guarded ALTER; safe to re-run.
 */
export const migration044ChatChannel = {
  version: 44,
  up: ({ db, tableExists, hasColumn }) => {
    if (tableExists("chats") && !hasColumn("chats", "channel")) {
      db.run(
        "ALTER TABLE chats ADD COLUMN channel TEXT NOT NULL DEFAULT 'direct'",
      );
      db.run("CREATE INDEX IF NOT EXISTS idx_chats_channel ON chats(channel)");
    }
  },
};
