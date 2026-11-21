/**
 * Migration 043: Per-user interface language.
 *
 * ChatDesk ships bilingual UI (English / Persian). Every account stores its
 * own interface language so the client can render the chosen language right
 * after login, on any device — the preference follows the user, not the
 * browser.
 *
 * - `users.language`: 'fa' (Persian, default) or 'en' (English).
 *
 * Idempotency: guarded ALTER; safe to re-run.
 */
export const migration043UserLanguage = {
  version: 43,
  up: ({ db, tableExists, hasColumn }) => {
    if (tableExists("users") && !hasColumn("users", "language")) {
      db.run("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'fa'");
    }
  },
};
