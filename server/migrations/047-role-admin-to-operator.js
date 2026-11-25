/**
 * Migration 047: Retire the "admin" role — normalize it to "operator".
 *
 * ChatDesk's role model is now exactly three roles:
 *
 *   owner    — the system owner; full access to everything (admin panel
 *              included) and the only role that may delete messages,
 *              tickets/threads, and chats.
 *   operator — staff: handles support tickets and moderates conversations.
 *   user     — regular customer account (the "Customer" account type).
 *
 * The intermediate "admin" role was never meaningfully used (the owner
 * creates operators and customers), and keeping it around left dead
 * branches in filters, badges, and permission checks. Every existing
 * account with role 'admin' is staff, so it becomes an operator; the
 * panel itself is owner-only from this version on.
 *
 * Data migration (no schema change): UPDATE users SET role='operator'
 * WHERE role='admin'. Safe to re-run; a no-op when no admin rows exist.
 * Old backups restored on this instance re-run this migration through the
 * normal migration tracking and are normalized the same way.
 */
export const migration047RoleAdminToOperator = {
  version: 47,
  up: ({ db, tableExists, hasColumn }) => {
    if (!tableExists("users") || !hasColumn("users", "role")) return;
    db.run(
      "UPDATE users SET role = 'operator' WHERE LOWER(COALESCE(role, '')) = 'admin'",
    );
  },
};
