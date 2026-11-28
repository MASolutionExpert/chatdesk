/**
 * Migration 049: Restore push_subscriptions.message_preview on SQLite.
 *
 * Migration 036 (UUID primary keys) rebuilt push_subscriptions on the SQLite
 * path WITHOUT the message_preview column that migration 028 had added. The
 * rebuild silently dropped the column on every SQLite install (fresh AND
 * upgraded), so web push broke completely:
 *   - upsertPushSubscription → "table push_subscriptions has no column named
 *     message_preview"
 *   - listPushSubscriptionsByUserIds → "no such column: message_preview"
 *
 * 036 itself is fixed (the rebuild now carries the column over); this
 * migration self-heals every install whose 036 already ran with the old
 * code, on both dialects (PostgreSQL was unaffected — its 036 path converts
 * the FK column in place — but the guarded ADD is harmless there).
 *
 * Idempotency: guarded ALTER; safe to re-run.
 */
export const migration049PushMessagePreviewRestore = {
  version: 49,
  up: ({ db, tableExists, hasColumn }) => {
    if (
      tableExists("push_subscriptions") &&
      !hasColumn("push_subscriptions", "message_preview")
    ) {
      db.run(
        "ALTER TABLE push_subscriptions ADD COLUMN message_preview INTEGER NOT NULL DEFAULT 1",
      );
    }
  },
};
