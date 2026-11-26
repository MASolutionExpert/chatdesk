/**
 * Migration 048: Role permission overrides (configurable permission matrix).
 *
 * ChatDesk's permission system (1.7.0) is REGISTRY-DRIVEN: the registry of
 * permissions, their labels and their per-role built-in defaults lives in
 * server/lib/permissions.js (single source of truth). This table stores ONLY
 * explicit admin overrides — a (role, permission) pair absent from the table
 * falls back to the registry default.
 *
 * Consequences of that design:
 *   - Adding a permission to the registry in the future needs NO migration:
 *     it appears in the admin panel with its built-in defaults immediately.
 *   - The instance owner ('owner') is intentionally NOT configurable here —
 *     the service short-circuits every owner check to "allowed".
 *   - Resetting an override to the default deletes its row.
 *
 * Idempotency: CREATE TABLE IF NOT EXISTS + guarded unique index; safe to
 * re-run. Dual dialect: SQLite (INTEGER booleans) and PostgreSQL — the
 * migration runner normalizes the SQL.
 */
export const migration048RolePermissions = {
  version: 48,
  up: ({ db, tableExists }) => {
    if (!tableExists("role_permissions")) {
      db.run(`
        CREATE TABLE IF NOT EXISTS role_permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL,
          permission TEXT NOT NULL,
          allowed INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT
        )
      `);
    }
    // Keep (role, permission) unique so the service's update-then-insert
    // upsert stays correct; IF NOT EXISTS keeps the migration idempotent.
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique
        ON role_permissions(role, permission)
    `);
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role)",
    );
  },
};
