# Helpdesk (Departments & Operators)

ChatDesk can run as a **chat-first helpdesk**: customers experience it like a
regular messenger, while every support conversation is routed behind the
scenes to the right team.

## Two strictly separated message domains

Messenger and tickets are two independent domains — separate routing, separate
tables, separate lifecycle:

- **Messenger (direct)** — opened by finding a user's ID. Allowed only between
  two customers or two staff members; `POST /api/chats/dm` refuses
  customer↔staff pairs (403 `support_only`). No ticket row exists for these
  chats.
- **Tickets (support)** — a customer picks a department and the request is
  routed to an operator. Every support chat is registered in the `tickets`
  table (customer, department, assigned operator, open/closed lifecycle,
  migration 045). Either party can close or reopen the ticket from the chat
  window; a closed ticket stops accepting messages until reopened.

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
   department with the *fewest open tickets* (open/closed is the ticket's own
   lifecycle status in the `tickets` table). Ties are broken round-robin
   (longest time since last assignment wins).
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
| `GET` | `/api/admin/support/report` | Time-filtered performance report (`?departmentId=&from=&to=`, dates inclusive) |

## Department performance report

Clicking a department name in the Helpdesk tab's summary opens a **dedicated
report page** for that department — a standard reporting panel for department
and operator performance with a precise time filter (from/to dates, plus
Today / Last 7 days / Last 30 days / All-time presets).

Every number is computed **server-side** (`GET /api/admin/support/report`),
so SQLite and PostgreSQL installations report identical figures. Metrics:

| Metric | Definition |
| --- | --- |
| Conversations | support chats **created** in the range |
| Messages | messages **authored** in the range inside the department's chats (any chat age) |
| Staff replies / Customer messages | the author-role split of those messages |
| Tickets opened / closed / still open | ticket lifecycle rows created / closed in the range; "still open" = opened in-range and not yet closed |
| Answered / Unanswered | conversations created in the range whose last message is staff-authored vs customer-authored (or never written) |
| Avg first response | mean of (first staff reply − conversation creation), per operator and per department |

A conversation is attributed to its ticket's operator; legacy chats without a
ticket row fall back to the author of the first staff reply. Each operator
card on the report page shows eight per-person metrics: assigned
conversations, answered / unanswered, every in-range message inside their
attributed conversations (`messagesInConversations`), tickets opened / closed
/ still open, and their average first response. The staff/customer message
split stays on the department summary.

> گزارش عملکرد دپارتمان — با کلیک روی نام هر دپارتمان در خلاصهٔ میز خدمت، صفحهٔ اختصاصی آن دپارتمان باز می‌شود: فهرست اپراتورها، خلاصهٔ وضعیت و عملکرد آن‌ها، و یک پنل گزارش‌گیری استاندارد با فیلتر زمانی دقیق (از/تا + میان‌برهای امروز، ۷ روز، ۳۰ روز و همهٔ زمان‌ها). تعداد گفتگوها و تیکت‌ها، پاسخ‌های داده‌شده و بدون پاسخ و میانگین زمان اولین پاسخ در همان بازهٔ انتخابی، همه سمت سرور محاسبه می‌شود. کارت هر اپراتور هشت شاخص فردی را نشان می‌دهد؛ تفکیک پیام‌های پشتیبانی/مشتری فقط در خلاصهٔ دپارتمان نمایش داده می‌شود.

## Database

Departments are created by migration `042-departments`:

- `departments` table
- `users.department_id` (operators)
- `chats.department_id` (support conversations)

It runs automatically on server boot for both SQLite and PostgreSQL, and is
included in database backups.
