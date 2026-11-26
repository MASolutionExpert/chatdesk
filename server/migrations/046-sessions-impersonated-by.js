/**
 * Migration 046: Owner impersonation session marker.
 *
 * The owner can "log in as" a user from the admin panel (monitoring). That
 * mints a NEW session for the target user, while the owner's real session is
 * parked in a dedicated `admin_sid` cookie. To make the impersonation
 * verifiable server-side — and safely reversible — every impersonation
 * session is stamped with the id of the owner who created it:
 *
 * - `sessions.impersonated_by`: TEXT, NULL for normal logins; the owner's
 *   user id for sessions minted through `POST /api/admin/users/:id/impersonate`.
 *
 * `/api/me` exposes it as `impersonatedBy` so the client can show the
 * "you are browsing as … / return to admin" banner. The return endpoint
 * requires the stamp to match the parked owner cookie before it revokes the
 * working session — a fresh login can never be torn down by a stale cookie.
 *
 * Additive, nullable column: every existing INSERT (`user_id`, `token`)
 * keeps working and reads back as NULL. Compatibility sweep (AGENTS.md rule
 * 13): all `sessions` writers go through `db.js createSession` (updated to
 * accept the optional stamp); all readers go through `db.js getSession`
 * (updated LEFT JOIN) or raw token lookups, none use SELECT *.
 *
 * Idempotency: guarded ALTER; safe to re-run.
 */
export const migration046SessionsImpersonatedBy = {
  version: 46,
  up: ({ db, tableExists, hasColumn }) => {
    if (tableExists("sessions") && !hasColumn("sessions", "impersonated_by")) {
      db.run("ALTER TABLE sessions ADD COLUMN impersonated_by TEXT");
    }
  },
};
