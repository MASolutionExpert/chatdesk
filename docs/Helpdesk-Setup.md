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

- Created only by the owner (`Users` tab → `New user` → account type
  `Operator`) or via the CLI:
  ```bash
  npm run db:user:create -- --nickname "Sara Ahmadi" --username sara \
    --password "..." --role operator
  ```
- The CLI role flag accepts `user | operator | owner` (the retired "admin"
  role is no longer assignable).
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
| `GET` | `/api/support/tickets/:chatId/refer-candidates` | Staff-only: the referral picker's directory — full staff list (minus the actor, each flagged `inTicket` when already in the thread) + active departments |
| `POST` | `/api/support/tickets/:chatId/refer` | Staff-only: hand the ticket to another operator (`{ creator, operatorUsername }` or `{ creator, operatorId }`) |

## Ticket referral (sharing a ticket between operators)

Any staff member can hand a ticket to another operator from inside the chat
window: the ticket strip (next to **Close ticket**) shows a **Refer ticket**
button for operators and the owner — customers never see it. The picker offers
three ways to choose a target:

- **Search** across the whole staff directory by username, nickname, or user
  ID.
- **Browse by department** — click a department to unfold its complete
  operator list (alias first). Operators without a department appear under
  their own "No department" group.
- **Direct handoff** — paste an operator **ID (UUID)** or **@username** into
  the "Refer by ID or username" field; the server validates the target.

Candidates are sorted by **recent contact** (most recent exchanged message
first, marked "Recent"). Staff who are already members of the thread stay
listed but disabled with an "In this ticket" badge — the server refuses them
with `409`.

What happens on confirm (all server-side, one atomic endpoint
`POST /api/support/tickets/:chatId/refer`):

- The support thread is **converted in place from a DM into a private support
  group** that keeps its support identity (channel `support` + department
  tag). It looks and behaves like any messenger group — invite link, avatar,
  member management, group settings — but stays a ticket: the admin panel and
  the chat window still show it with the red headset ("Ticket") badge.
- The chosen operator **joins the thread as the group owner** and becomes the
  ticket's operator of record, so fair routing counts the open ticket against
  their workload. Referring again adds further operators (every staff member
  in the thread can read and reply; the most recently referred operator holds
  the group ownership and the ticket record).
- The customer is demoted to a plain chat member and keeps their usual
  experience; a `[[system:referred:<name>]]` message marks the handoff in the
  thread, and the target operator gets a push notification.
- Guards: only staff may refer; direct (messenger) chats are refused
  (`400 not_a_ticket`); closed tickets, non-staff targets, self-referral,
  and already-member targets are refused; non-member operators get `403`.

The referred ticket stays fully protected by the platform's deletion policy:

- `POST /api/chats/hide` (delete thread) and
  `POST /api/chats/group/:chatId/delete` remain **owner-only** for support
  groups — even the operator who owns the support group gets `403`.
- The customer can never be dropped from the thread (remove-member refuses;
  group-settings member sync silently restores them).
- The last staff member cannot abandon the thread by leaving; when a staff
  owner leaves, ownership passes to another staff member — never to a
  customer.
- A new support request from the same customer starts a **fresh ticket** — a
  referred group is never silently reused as someone else's ticket.

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
| First responses (operator) | how many in-range tickets the operator answered FIRST — the sample size behind their average |
| Avg first response (department + operator) | mean of (first staff reply − ticket creation) over tickets created in the range: the department total averages ALL answered tickets of the range; each operator averages the tickets THEY answered first. Unanswered tickets stay out of the average; a first reply written after the window end still belongs to its in-range ticket |

A conversation is attributed to its ticket's operator; legacy chats without a
ticket row fall back to the author of the first staff reply. The first-response
sample however always belongs to the operator who ACTUALLY wrote the first
staff reply — whoever fair routing assigned the ticket to at creation time.
Only when that author is not on the department roster (a passing admin, a
departed operator) does the sample fall back to the ticket's recorded operator.
Each operator card on the report page shows nine per-person metrics:
assigned conversations, answered / unanswered, every in-range message inside
their attributed conversations (`messagesInConversations`), tickets opened /
closed / still open, their first-response count (the average's sample size)
and their average first response. The staff/customer message split stays on
the department summary.

> گزارش عملکرد دپارتمان — با کلیک روی نام هر دپارتمان در خلاصهٔ میز خدمت، صفحهٔ اختصاصی آن دپارتمان باز می‌شود: فهرست اپراتورها، خلاصهٔ وضعیت و عملکرد آن‌ها، و یک پنل گزارش‌گیری استاندارد با فیلتر زمانی دقیق (از/تا + میان‌برهای امروز، ۷ روز، ۳۰ روز و همهٔ زمان‌ها). «میانگین اولین پاسخ» در همان بازهٔ انتخابی سمت سرور محاسبه می‌شود: برای هر اپراتور، میانگین فاصلهٔ «اولین پاسخ منهای زمان ایجاد تیکت» روی تیکت‌هایی که خودش اولین پاسخ را نوشته است (نمونه به اپراتوری تعلق می‌گیرد که واقعاً اولین پاسخ را داده، نه اپراتوری که تیکت هنگام ایجاد به او تخصیص یافته؛ اگر نویسندهٔ اولین پاسخ در فهرست اپراتورهای دپارتمان نباشد، نمونه به اپراتور ثبت‌شدهٔ روی تیکت برمی‌گردد)؛ و در خلاصهٔ دپارتمان، میانگین روی تمام تیکت‌های پاسخ‌داده‌شدهٔ بازه (میانگین عملکرد همهٔ اپراتورها). تیکت‌های بدون پاسخ در میانگین نمی‌آیند و تعداد «اولین پاسخ‌ها» روی کارت هر اپراتور نشان می‌دهد میانگین بر اساس چند تیکت است. کارت هر اپراتور نُه شاخص فردی را نشان می‌دهد؛ تفکیک پیام‌های پشتیبانی/مشتری فقط در خلاصهٔ دپارتمان نمایش داده می‌شود.

## Database

Departments are created by migration `042-departments`:

- `departments` table
- `users.department_id` (operators)
- `chats.department_id` (support conversations)

It runs automatically on server boot for both SQLite and PostgreSQL, and is
included in database backups.
