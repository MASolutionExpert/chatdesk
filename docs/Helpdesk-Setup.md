# Helpdesk (Departments & Operators)

Songbird can run as a **chat-first helpdesk**: customers experience it like a
regular messenger, while every support conversation is routed behind the
scenes to the right team.

## How it works

1. **Super admin creates departments** in the admin panel
   (`Helpdesk` tab → `New department`), e.g. *Technical Support*, *Billing*.
2. **Super admin creates operators** in the `Users` tab
   (`New user` → account type `Operator` → department). Operators sign in like
   normal users — their inbox is the regular chat list.
3. **Customers pick a department** right after signing up (the
   `/departments` page) or any time later via the sidebar menu
   (`+` → `Contact support`).
4. **Fair routing** assigns the conversation to the operator in that
   department with the *fewest open conversations* (open = the customer sent
   the last message). Ties are broken round-robin (longest time since last
   assignment wins).
5. The support conversation is a **regular DM chat** tagged with the
   department, so every messenger feature keeps working: files, voice
   messages, calls, push notifications, offline queue, encryption.
6. When the customer writes to support again, the server reuses the existing
   DM with the same operator (or routes to another operator if they had a
   different, unassigned pair), so threads stay messenger-like.

## Operator accounts

Operators are normal accounts with the `operator` role:

- Created only by the owner/admin (`Users` tab → `New user` → account type
  `Operator`) or via the CLI:
  ```bash
  npm run db:user:create -- --nickname "Sara Ahmadi" --username sara \
    --password "..." --role operator
  ```
- The CLI role flag accepts `user | operator | admin | owner`.
- Operators do **not** have access to the admin panel.
- A user's department can be changed at any time via
  `PATCH /api/admin/users/:id` with `{ "department_id": <id> }` (or the admin
  UI). Departments are edited in the `Helpdesk` tab.

## Admin API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/departments` | Active departments (authenticated users) |
| `POST` | `/api/support/request` | Create/continue a fairly-routed support conversation |
| `GET` | `/api/admin/departments` | All departments + operators per department |
| `POST` | `/api/admin/departments` | Create department `{ name, description, color }` |
| `PATCH` | `/api/admin/departments/:id` | Edit / activate / deactivate |
| `DELETE` | `/api/admin/departments/:id` | Soft delete (deactivates, keeps history) |
| `GET` | `/api/admin/support/overview` | Per-department reports + latest conversations |

## Reports

The `Helpdesk` tab in the admin panel shows, per department:

- Total conversations, open conversations, total messages
- Operators on duty
- The latest support conversations with their state
  (`awaiting reply` = the customer sent the last message)

## Database

Departments are created by migration `042-departments`:

- `departments` table
- `users.department_id` (operators)
- `chats.department_id` (support conversations)

It runs automatically on server boot for both SQLite and PostgreSQL, and is
included in database backups.
