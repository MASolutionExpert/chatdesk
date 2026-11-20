/**
 * Migration 042: Departments & support (helpdesk) routing.
 *
 * Turns Songbird into a chat-first helpdesk: customers pick a department and
 * get routed fairly to an operator, while every support conversation stays a
 * regular DM chat so all messenger features (files, calls, push, SSE) work.
 *
 * - `departments`        : the support departments operators belong to.
 * - `users.department_id`: which department an operator/admin serves (nullable).
 * - `chats.department_id`: marks a DM chat as a support conversation (nullable).
 *
 * Idempotency: CREATE TABLE IF NOT EXISTS + guarded ALTERs; safe to re-run.
 */
export const migration042Departments = {
  version: 42,
  up: ({ db, tableExists, hasColumn }) => {
    if (!tableExists("departments")) {
      db.run(`
        CREATE TABLE IF NOT EXISTS departments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          color TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    }
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(active)",
    );

    if (tableExists("users") && !hasColumn("users", "department_id")) {
      db.run("ALTER TABLE users ADD COLUMN department_id INTEGER");
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id)",
      );
    }

    if (tableExists("chats") && !hasColumn("chats", "department_id")) {
      db.run("ALTER TABLE chats ADD COLUMN department_id INTEGER");
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_chats_department ON chats(department_id)",
      );
    }
  },
};
