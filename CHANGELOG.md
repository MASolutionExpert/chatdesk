# Changelog

All notable changes to ChatDesk are documented in this file.

## 1.5.0-dev.5

### Added

- 🛠️ **New "Rebuild & Restart" deploy-menu option (`r`).** The Update option only rebuilds when the remote has newer commits — source pulled by hand (or an aborted update) left the running services out of sync with the source tree with no menu path to fix it. The new option re-runs the full source finalization pipeline **without pulling new code and without the "already up to date → downgrade?" prompt**: server/worker/client dependencies, client build, database schema sync, systemd unit refresh, service restarts and nginx reload — with the same failure recovery as the update flow. Docs: `docs/Deployment-Script.md` menu table updated.

## 1.5.0-dev.4

### Fixed

- 🔧 **Updates no longer abort with "Your local changes would be overwritten by merge".** `npm install` on the deployment box rewrites the tracked `client/package-lock.json` / `server/package-lock.json` files, so the next `git pull --ff-only` refused to merge and every update failed until the tree was cleaned by hand. The updater now **auto-stashes** local source modifications (tracked + untracked) before every fast-forward pull — in the update flow, the channel switch flow, and the installer's own repo-sync step. The stash keeps a recoverable copy on the box (`git stash list` inside `/opt/chatdesk`); a clean tree simply moves on. Docs: `docs/Deployment-Script.md` update section updated.

## 1.5.0-dev.3

### Fixed

- 🎫 **Admin chats: ticket threads are now labeled "Ticket", not "Direct messages".** The admin panel's Chats (Messages) tab stamped every support ticket with BOTH labels — the stored chat type is `dm`, so the Type column said "Direct messages" while a second badge said "Ticket". `adminListChats` now derives an explicit **`isTicket`** classification (support-channel DM) on every row; the panel shows a rose headset icon with "Ticket" / «تیکت» in the Type column and the ticket's **department** next to the SUPPORT badge (instead of a duplicate ticket label). Messenger DMs, groups and channels are untouched.
- 📊 **The operator first-response metric is credited to the operator who ACTUALLY answered, not to whoever the ticket was routed to.** In 1.5.0-dev.2 the per-ticket first-response sample rode the ticket row's `operator_id` — the operator fair routing picked **at creation time**. When a different operator answered the ticket (the reported case: a new ticket, answered, and the answering operator's card still showed "—"), the sample landed on the assigned operator and the responder got nothing. The sample now always belongs to the **author of the first staff reply**; only when that author is not on the department roster (a passing admin, a departed operator) does it fall back to the ticket's recorded operator. Conversation-level metrics (assigned / answered / unanswered) still follow the ticket row.

**Tests:** 140 files / 1340 server tests (new: off-roster first-reply fallback, explicit `isTicket` list classification; the "someone else replied first" contract re-pinned to author attribution), 427 client unit tests — all green. Docs: `docs/Helpdesk-Setup.md` metric attribution rewritten (EN + FA), `docs/Admin-Panel.md` Chats tab updated.

## 1.5.0-dev.2

### Changed

- 📊 **The department-report response metric now follows the classic helpdesk definition, end to end.** After operator feedback on 1.5.0-dev.1 (which measured a per-reply latency that blurred the picture), the metric is back to **first response per ticket**, exactly as admins expect it:
  - **Per operator** — mean of (first staff reply − ticket creation) over the operator's **own tickets created in the selected range** (the time-filter / Today / 7-day / 30-day presets all apply). One sample per ticket; tickets with no reply yet stay out of the average.
  - **Department total** — the same average over **ALL answered tickets of the range**, i.e. the combined performance of all its operators (ticket-weighted, not a simple mean of operator means).
  - A first reply written after the window end still belongs to its in-range ticket ("the average of all tickets of the range").
  - ➕ **New "First responses" tile on each operator card** — the number of their in-range tickets that received a reply, i.e. the sample size behind the average, so the figure is verifiable at a glance.
  - `docs/Helpdesk-Setup.md` metric table rewritten (EN + FA); API contract returns `firstResponses` / `avgFirstResponseSeconds` per operator again.

**Tests:** 140 files / 1338 server tests (aggregation contract re-pinned: per-ticket attribution incl. "someone else replied first", multi-ticket operator average, post-window first reply inclusion), 427 client unit tests — all green.

## 1.5.0-dev.1

### Fixed

- 📊 **The operator "Avg response time" in the department report now really measures the operator's own performance** (dev series carry: `1.4.0-dev.9` → `1.5.0-dev.1`). Three root causes fixed in `server/lib/supportReport.js`:
  1. **Misattribution** — response-time samples were credited to the ticket's *assignee*, not to whoever actually wrote the reply: an operator who never replied inherited someone else's latency, while the operator who did reply showed "—". Response times are now attributed to the reply's **author** (if on the department roster); conversation ownership (assigned / answered / unanswered) still follows the ticket.
  2. **Wrong latency basis** — the metric measured (first staff reply − chat creation), one sample per conversation, ignoring every later reply. The operator metric is now **per-reply**: every staff reply authored in the range that answers a *pending* customer message counts, latency = reply − the latest pending customer message, and any staff message resolves the pending request (consecutive staff replies without a new customer question score only the first one). Pending requests may span the range boundary (asked in May, answered in June — the June reply still counts, any chat age).
  3. **Out-of-window samples** — the department's "Avg first response" also counted first replies written *after* the window ended (a chat created June 30, answered July 2 inflated the June average). The department total now only counts first staff replies written inside the range. The operator card label became "Avg response time" / «میانگین زمان پاسخ»; the department total keeps "Avg first response" / «میانگین اولین پاسخ».

**Tests:** 140 files / 1339 server tests (4 new: author-not-assignee attribution, per-reply latency incl. consecutive-reply and window-boundary cases, and out-of-window first-reply exclusion; contract updated to `responses` / `avgResponseSeconds`), 427 client unit tests. Docs: `docs/Helpdesk-Setup.md` metric table rewritten (EN + FA).

## 1.4.0-dev.9

### Added

- ⏳ **Time filter for the admin Chats tab — the same precise range filter as the helpdesk.** From/to date inputs plus **Today / Last 7 days / Last 30 days / All time** presets now filter the chat list by creation date. Backend-first: `GET /api/admin/chats` accepts `createdFrom` / `createdTo` (strict `YYYY-MM-DD`, anything else → 400) and `adminListChats` applies the window in SQL with bounds engineered for the column's MIXED timestamp formats — SQLite's `"YYYY-MM-DD HH:MM:SS"` and ISO `"YYYY-MM-DDTHH:MM:SSZ"` both sort after the bare date prefix (inclusive `>= from`), and the `to` bound is the exclusive next-day start so a late-night ISO timestamp on the last day is still included. UTC day boundaries, matching the support report.

### Changed

- 🎫 **"Support messages" added to the Chat Type filter, right under "Direct messages"** — selecting it surfaces the helpdesk ticket threads (support-channel DMs). Backend: `type=support` maps to `type='dm' AND channel='support'` server-side (the redundant standalone channel filter section was removed from the UI since the type filter now covers it; the `channel` API parameter still works).

### Fixed

- 👥 **The group/channel edit modal now shows the EXISTING members.** Previously, editing a group that visibly had members in the chat list opened an edit page with an empty member selection — the admin could never see the current membership. The modal now loads `GET /api/admin/chats/:id/members` on mount and renders every existing member as a selected chip (the owner stays in the OwnerPicker). The chips are now a real membership editor: kept chips are no-ops on save, removed chips delete the member (`DELETE /api/admin/chats/:id/members/:userId`), new chips add them — with guards so ownership transfer (which rides the PATCH) is never clobbered.

**Tests:** 140 files / 1335 server tests (6 new: real-SQLite integration for the support-type filter and the mixed-format date window incl. spanning/out-of-range/intersect cases, plus API param-passthrough and 400-on-bad-date), 427 client unit tests, **556 client browser tests** — the CI Browser job failure of 1.4.0-dev.8 is also fixed here: the Emergency Claim UI suite is re-pinned to the new gating contract (lockout-only form, Access denied on healthy installs, monitoring sessions never see the form).

## 1.4.0-dev.8

### Fixed

- 🔐 **Security hardening round 2 — the "/admin Emergency Claim" leak, the parked-owner-session logout gap, and two brute-force surfaces, all closed.** **(1) The Emergency Claim token form is no longer shown to everyone.** Any logged-in non-admin who opened `/admin` — including a monitoring session created through the owner's "Log in as user" (which is exactly what appeared when pressing the browser Back button after entering a user's panel) — was greeted by the "Emergency Claim / Admin API Token" prompt. The server was never at risk (the claim endpoint still requires the real token), but the UI leaked the mechanism's existence to every user and offered a probing surface. The client now renders the form ONLY when the server reports a genuine lockout: a new `adminClaimAvailable` field on `GET /api/app/info` (true **only** when `ADMIN_API_TOKEN` is configured AND no admin/owner exists, failing closed on any error) gates the form; every other case renders a bilingual "Access denied" card with a back button, and monitoring sessions are additionally hard-redirected from `/admin` back to the chat — no admin UI at all renders for an impersonation session. **(2) Logging out while monitoring no longer leaves the owner session alive.** `POST /api/logout` now also destroys the owner session parked in the HttpOnly `admin_sid` cookie and clears that cookie (previously the parked session survived up to 14 days in the browser and the session store — an unnecessary risk window). **(3) Brute-force hardening:** the emergency claim endpoint gets its own strict bucket (**10 attempts / 15 min per IP**, previously it rode the 3000/15min admin budget — enough for a human, useless for token guessing), and `/api/login` + `/api/register` get a dedicated **50 / 15 min** bucket so credential stuffing cannot ride the shared chat budget. **(4) Back/forward-cache stale identity:** a bfcache restore (browser Back/Forward) can resurrect a page whose rendered identity no longer matches the session cookie; the app now reloads on `pageshow` with `persisted=true` so `/api/me` re-syncs the identity with the server. Suite: 139 files / 1326 server tests (9 new: claim-gate matrix incl. fail-closed + parked-session logout + defensive same-token edge), 427 client unit tests, 35 worker tests green.

## 1.4.0-dev.7

### Added

- 👤 **Owner impersonation — "Log in as user" lands in the admin panel's Users tab.** The owner can now click the new login button on any user row and drop straight into that user's own app view — no password, no username, one click — for supervision and monitoring. Security is enforced server-first, not by hiding buttons: `POST /api/admin/users/:id/impersonate` hard-gates on the owner role (`owner_only` for anyone else), refuses the owner account itself (`owner_protected`), banned users, self-impersonation and unknown ids; it mints a fresh random session for the target user, parks the owner's real session in a dedicated HttpOnly `SameSite=Lax` `admin_sid` cookie, and never reads, exposes or touches any password. Every minted session is stamped with the acting owner's id (new additive, nullable `sessions.impersonated_by` column — migration 046, guarded ALTER, compatibility sweep per AGENTS.md rule 13), `/api/me` surfaces that stamp as `impersonatedBy`, and the client shows a persistent amber monitoring banner with a "Return to admin panel" button. The return endpoint (`POST /api/admin/impersonate/return`) lives outside the normal admin gate (the working session belongs to the impersonated user) and re-verifies everything itself: the parked cookie must resolve to a live admin/owner session, and the working session must be an impersonation session stamped by THAT owner — a fresh login can never be revoked by a stale parked cookie. On return the owner's session is restored, the minted session is revoked, the side cookie cleared, and both directions are written to the admin audit log (`user.impersonate`, `user.impersonate_return`). Suite: 138 files / 1317 server tests (13 new: full API security matrix + real-SQLite integration for the stamp), 427 client unit tests, 35 worker tests green.

### Changed

- ✂️ **The promote/demote shield buttons are gone from the Users tab.** The inline admin shield toggle (promote to admin / demote from admin) is removed entirely from every row branch — mobile and desktop — because role changes already live in the edit modal, and the duplicate shield was cluttering the list. Role management is unchanged in behavior (`POST /api/admin/users/:id/role` and the edit modal still work exactly as before); the list row is now edit, owner-only "Log in as user", ban, delete. The now-orphaned i18n keys (`promote`, `promoteMsg`, `demote`, `demoteMsg`, `errSelfRole`, `errRoleOwner`, `errRoleAdmins`, `errRoleBanned`, `errDemoteOwner`) were removed from both the English and Persian dictionaries, and `admin.users.loginAs` ("Log in as user" / «ورود به عنوان کاربر») plus the monitoring-banner strings were added bilingually.

## 1.4.0-dev.6

### Fixed

- 🔎 **Full compatibility audit of migration 036 (UUID primary keys) — two more silent Number()-on-UUID bugs found and fixed.** Following the department-report "only the last operator" incident, the ENTIRE codebase was swept for every consumer of the UUID-converted columns (`users.id`, `chats.id`, `chat_messages.id` and all ~25 referencing FKs across `chat_members`, `sessions`, `push_subscriptions`, `tickets`, `admin_audit_logs`, …): every Map/Set key, equality check and SQL binding that coerced a UUID through `Number()`. Two additional real bugs surfaced and are fixed. **(1) The diagnostics chat snapshot (`lib/inspect.js`) reported 0 members for every chat** — it converted chat ids with `Number()`, the member `whereIn` matched nothing, and the per-chat member grouping collapsed onto NaN; it now keys by the raw string UUIDs (verified by new tests that feed real UUID shapes and assert both the grouping and the SQL bindings stay raw). **(2) The startup message-body encryption backfill (`index.js`) silently never encrypted legacy plaintext** — its `UPDATE chat_messages … WHERE id = Number(row.id)` produced `WHERE id = NaN`, matching no row on every boot; the decision logic is now extracted into the pure, testable `lib/storageEncryptionBackfill.js` (`planMessageBodyEncryption`) whose contract pins that the update addresses the RAW id. Everything else audited clean: department ids are legitimately numeric, `remote_channel_*` / `chat_message_files` ids are INTEGER by design, the Postgres INT8 parser only touches bigint flags/counts, and the client (React) uses no numeric coercions on user/chat/message ids. The audit checklist is now a permanent agent law — **AGENTS.md rule 13: "Schema/migration compatibility sweep"** — every future fundamental data-structure change must enumerate affected columns, grep every consumer in `server/` AND `client/`, fix each, and pin the change with tests using real production-shaped fixtures (numeric test ids are what hid this whole bug class in the first place). Suite: 136 files / 1301 server tests, 427 client unit tests green.

## 1.4.0-dev.5

### Fixed

- 🐛 **The department report shows EVERY operator again — the "only the last operator has performance" bug is fixed.** Since migration 036 the `users`, `chats` and `chat_messages` primary keys are TEXT UUIDs, but the support-report aggregation keyed every internal map by `Number(id)` — and `Number("uuid")` is `NaN`. Because JavaScript Maps match `NaN` via SameValueZero, ALL operators, chats, messages and tickets collapsed onto a single "last row wins" bucket: the department page rendered exactly one operator card (the last one on the roster) holding everyone's numbers, per-chat histories merged into one, and staff/customer classification judged by the last user's role. Every key is now `String(id)` (departments keep their INTEGER ids and stay numeric), the message-history query no longer converts chat UUIDs through `Number()` (which silently emptied the `WHERE chat_id IN (...)` clause), and the same NaN pattern in the support overview's legacy fallback (`lastMessageByCustomer` / ticket-open heuristic) now compares ids as strings too. The gap that hid all of this is closed at both layers: three new aggregation tests feed the report real production shapes (UUID user/chat/message ids, integer department ids) and would fail on the old code, plus a brand-new real-database integration suite that builds a department with three operators, real support chats, tickets and messages through the public `db.js` API and asserts the full db → aggregation path end-to-end (it was previously only ever tested through mocks). Suite: 135 files / 1294 server tests, 427 client unit tests green.

### Changed

- ✂️ **Operator report cards slimmed to the eight metrics that describe the person.** Each operator card on the department page drops the last two cards — "Staff replies" and "Customer messages" — keeping conversations (assigned), answered, unanswered, messages, tickets opened / closed / still open and average first response (2×4 grid). The department summary still shows the staff/customer message split; the server keeps computing every metric for both levels.

## 1.4.0-dev.4

### Changed

- 📈 **Per-operator report cards now show the full department-grade metric set.** On the dedicated department page, each operator card replaces the previous seven compact chips with the same ten server-computed metric cards used by the department summary: conversations (assigned), answered, unanswered, messages (every in-range message inside the operator's attributed conversations), tickets opened / closed / still open, average first response, the operator's own staff replies, and customer messages in their conversations. Three of these are new server-side metrics — `messagesInConversations`, `customerMessages`, and `openTickets` per operator — computed by the pure aggregation layer (still driver-neutral for SQLite and PostgreSQL) and covered by 2 new aggregation tests. Suite: 134 files / 1288 server tests, 427 client unit tests green.

## 1.4.0-dev.3

### Added

- 📊 **Department performance report — a dedicated, time-filtered reporting panel per department (backend-first).** The admin Helpdesk tab's "latest support conversations" list is gone (the full history already lives in the messages), and every department name in the summary now opens a dedicated department page: its operators, their status and performance at a glance, and a standard reporting panel with a precise time filter (from/to dates plus Today / 7 days / 30 days / All-time presets). The server owns every number: a new pure aggregation layer (`server/lib/supportReport.js`) computes, per department and per operator, conversations created in the range, messages authored in the range (staff vs customer split), tickets opened / closed / still open, answered vs unanswered conversations, and the average first-response time — all behind the new admin-only `GET /api/admin/support/report?departmentId=&from=&to=` endpoint (401/403 for non-admins, 404 for unknown departments, 400 for invalid ranges). The aggregation is driver-neutral: SQLite and PostgreSQL produce identical numbers, and mixed timestamp formats (SQLite `datetime('now')` vs ISO) normalize to the same UTC instants. A conversation is attributed to its ticket's operator, falling back to the author of the first staff reply for legacy chats. **Tests:** 19 new tests — 13 pure-aggregation tests locking the metric contract for both drivers, 6 API contract tests (auth, param validation, 404, payload passthrough). Suite: 134 files / 1286 server tests, 427 client unit tests green.

## 1.4.0-dev.2

### Added

- 👑 **The system owner: first-setup ownership, permanent protection, owner-only "What's new" (backend-first).** **First-setup rule:** the very first user registered on a fresh installation automatically becomes the **owner** of the whole system (role `owner`) — the permanent owner of everything. **Full access:** the owner has every capability in the project (admin panel, settings, departments, helpdesk, calls — everywhere `isUserAdmin`/role gates apply, the owner passes). **Permanent protection (server-enforced, `403 owner_protected`):** nobody through the app — admins, operators, regular users, and even the owner via the admin panel — can edit, ban, delete, re-role or password-reset the owner account; a second owner can never be promoted while one exists. **Changes to the owner account happen ONLY from the server's interactive menu** (`chatdesk-deploy` → Manage Database → Edit user), which runs directly on the server outside the web surface; the owner's own profile self-service (nickname, avatar, own password) stays available in-app. **"What's new" is owner-only:** a new `GET /api/app/whats-new` endpoint serves the per-version changelog payload exclusively to the owner session (everyone else gets `403 owner_only`), the public `/api/app/info` no longer carries changelog fields, and the client shows the per-version changelog popup and the "What's new" (امکانات جدید) settings entry only when the server granted the payload. **Tests:** new `server/test/api/ownerAccount.test.js` — 16 tests covering the first-setup rule, immutability for every mutation endpoint (admin and owner actors), the one-owner rule, middleware pass-through, and the owner-only what's-new contract. Suite: 1267 server / 427 client unit green.

## 1.4.0-dev.1

### Fixed

- 🐘 **Migration 045 now actually completes on PostgreSQL — "(existing || []).map is not a function" is fixed.** The production incident: on the user's Postgres server the migration created the `tickets` table and indexes, then crashed in the backfill step. Root cause: in Postgres mode the migration context queues every query onto a promise chain, so `getAll`/`db.run` return **Promises** — while migration 045's `up` was written synchronously and treated the result as a plain row array. SQLite mode (and the stubbed CI test context) returns plain arrays, which is why the whole suite was green in CI yet the migration failed on the real server, leaving schema version stuck at 44. The fix: `up` is now async and awaits every `getAll` and every `db.run` in both driver modes; insert errors now propagate to the migration runner instead of being silently swallowed by the chain's catch. **Safe to re-run on the affected server:** the migration is idempotent (`IF NOT EXISTS` + guarded backfill), the existing empty `tickets` table is detected and the backfill fills it — nothing else on the server was changed (schema still at v44, pre-migration backup was taken automatically).
- 🧪 New regression suite `server/test/db/tickets045PostgresBackfill.test.js` (6 tests) reproduces the exact production crash with a thenable (Postgres-style) context: async contract, error propagation, guarded backfill for the partially-applied server state, incomplete-chat skipping, and SQLite-mode equivalence.

## 1.3.0-dev.9

### Changed

- 📐 **New permanent agent law: backend-first build order (`AGENTS.md`).** Every new feature must now be born in the backend — database migration, server logic, API endpoints, authorization, SSE events, API tests — and only after that contract's tests pass may the UI for it be built. A frontend-only implementation (tags/badges/buttons rendering state the server does not own) is explicitly forbidden. This codifies the delivery order that produced the messenger/ticket separation (dev.8: migration 045 `tickets` table → lifecycle/close/reopen APIs → routing from the ticket table → 13 API tests → then the client lifecycle strip).

## 1.3.0-dev.8

### Changed

- 🎫 **Messenger and tickets are now two strictly separated message domains — with the ticket owning its own database table.** A deep backend/database audit found the only separation was the `chats.channel` tag: nothing stopped a customer from opening a direct (messenger) chat with an operator or admin via `POST /api/chats/dm`, completely bypassing department routing, fair assignment and the ticket lifecycle. Three layers now enforce the boundary. **Rules:** customers (role `user`) reach staff (operator/admin/owner) ONLY through the support-request flow (department → fairly-routed operator); the DM endpoint refuses customer↔staff pairs in both directions (403 `support_only`); user↔user and staff↔staff remain messenger flows. **Ticket registry (migration 045):** a new `tickets` table — one ticket per support chat — records customer, department, assigned operator and the open/closed lifecycle with `closed_at`; every existing support chat is backfilled (idempotently). **Lifecycle:** both parties can close or reopen a ticket from the chat window; a closed ticket stops accepting messages (403 `ticket_closed`) until reopened; fair routing now counts each operator's open tickets from the table instead of the old customer-replied-last message heuristic; the admin support overview reports per-chat ticket status. Messenger chats never have a ticket row — direct chats are not affected by the lifecycle at all. Existing legacy customer↔staff threads are left untouched (no data migration); they can no longer be re-opened through the DM endpoint.

### Security

- 🔒 The messenger boundary is now server-enforced, not just a UI convention: the customer→staff direct-message path returns a `support_only` error pointing users at the department picker.

## 1.3.0-dev.7

### Fixed

- 🧪 **CI browser tests are green again — 554 tests, zero 20-second locator hangs.** ChatDesk defaults its UI language to Persian, but component tests render bare components (no `LanguageProvider`) and assert the English labels ("Type a message", "Call failed", …), so every name-based locator (`getByRole("textbox", { name: /type a message/i })`) waited out the full 20-second test timeout — dozens of tests per file, until the whole CI job hit its 10-minute cap. The suite had never actually run in CI (repository Actions were disabled; the check only appeared on the first stable promotion). Three-part fix: the provider-less default i18n context now resolves the persisted language dynamically instead of a hard-coded `fa` (production always mounts the provider, so behavior is unchanged), a new browser-test setup (`client/test/setup/browser-i18n.js`) seeds `localStorage["chatdesk.uiLanguage"] = "en"` before any component mounts, and `ChannelBadge` — the one suite asserting Persian labels on purpose — re-seeds `fa` per test. Locally verified: chromium 51 files / 554 tests all green (MessageComposer now 0.6 s instead of 499 s), unit suite 427 green.

### CI

- ⏱️ The "Run client browser tests" step timeout is raised 10 → 15 minutes for chromium + firefox headroom (healthy runtime is now ~6 minutes).

## 1.3.0-dev.6

### Fixed

- 📊 **The dashboard's "App Memory" gauge is no longer permanently red.** It divided the Node process's live heap (`heapUsed`) by the *currently allocated* heap (`heapTotal`) — but V8's garbage collector deliberately keeps live usage **near** the allocated heap and grows it on demand, so a perfectly healthy process reads 85–95% there. That is exactly what the user saw: ~94% red while the machine had 3.8 GB free and zero leaks. The gauge now measures the heap against its **real ceiling** — the V8 heap limit (`heap_size_limit`, ~4 GB by default, or `--max-old-space-size` when configured), which the server now exposes alongside the existing fields. The same healthy process now reads ~1% green, a genuinely leaking process still turns orange/red as it approaches the limit, and the gauge sublabel shows `used / limit` instead of `used / allocated`. Old server payloads without the new field fall back to the previous behavior.

### Tests

- 6 new tests: the endpoint exposes `heapLimit` ≥ `heapTotal` matching the runtime's actual `heap_size_limit`; the client metric measures against the limit (the screenshot's exact numbers 51 MB/54.1 MB/4 GB now read 1%), caps at 100%, falls back to `heapTotal` for old payloads, and handles empty input. Full suites: server 1232, client 427 (unit), worker 35 — all passing.

## 1.3.0-dev.5

### Fixed

- 📞 **Every call failure now says WHY it failed — in the user's language, on the call screen.** Until now every possible failure collapsed into one generic "Call failed" with a TURN hint, even when the cause had nothing to do with TURN (denied microphone permission, an HTTP (non-HTTPS) deployment, a missing microphone, the server rejecting the call). That made remote diagnosis impossible — a failure report said nothing about the actual cause. Each failure path now carries a precise machine-readable detail, and the call screen renders a specific message for it (English + Persian):
  - **Microphone/camera permission denied**, **no microphone/camera found**, **microphone busy with another app**, and **insecure context (HTTPS required)** each get their own message. An unsupported environment (calls attempted over plain HTTP) no longer fails silently without any feedback either.
  - **Server rejections show the server's own reason** ("The person you are calling is busy", "Calls are disabled on this server", ...) instead of a fake "Call failed".
  - **The TURN hint appears ONLY for a genuine media-path (ICE) failure**, and now says which level failed: relay candidates gathered but the call still failed (check the TURN server's credentials/logs), only STUN worked (classic restrictive NAT — set up TURN), even local candidates failed (the network blocks WebRTC — TURN over TCP/443), or no candidates at all. A short technical line under the message shows the gathered candidate types and whether TURN is configured, so a bug report finally contains the facts.
- 🔌 **Silent signaling failures no longer strand a call screen.** Three places where the call could die without either side ever learning about it:
  - A failed offer/answer relay over WebSocket (call reaped server-side, wrong chat) returned nothing — the sender hung on the calling/cConnected screen until the ring timeout. The gateway now sends `call:error` back to the sending socket with the server's reason (regression-tested).
  - The caller's offer relay and the callee's answer relay now verify delivery over the HTTP fallback too, and fail the call with the reason instead of leaving the other side hanging.
  - A failed `setRemoteDescription(answer)` on the caller only logged to the console, leaving the call dead on screen; it now ends the call as a handshake failure.
- 🔁 **A peer whose answer attempt itself failed no longer reports a bogus "Call declined" to the caller.** The reject path now distinguishes declined / busy / peer-media-failed / unsupported, and the caller's screen shows the matching label.

### Tests

- 17 new tests: WS gateway relay-error → `call:error` emission; media-error classification (permission/device/busy/insecure-context); TURN-configuration detection (`turn:`/`turns:` URLs, arrays, STUN-only); ICE failure verdicts (relay / srflx / host / none) with candidate de-duplication. Full suites: server 1231, client 422 (unit), worker 35 — all passing.

## 1.3.0-dev.4

### Fixed

- 📞 **"Call failed" root causes, round two — the server could poison a chat against itself.** Three defects that made every call attempt fail (often permanently) were found and fixed:
  - **Stale call entries poisoned the chat with 409s.** An active-call entry whose clients had all vanished (SSE-only client whose stream died without a close event, a device that never sent a clean disconnect) stayed in memory forever when `CALL_MAX_DURATION` was unset — and every later dial in that DM then hit `409 Call already in progress` and surfaced "Call failed". Instantly and forever, until the server restarted. Two fixes: the call manager now runs a **stale-call sweep** (default every 30s) that reaps a connected call once BOTH participants have been offline past a 45s grace window (a client mid-reconnect survives; a ringing call stays bounded by its own 60s ring timer), plus an absolute lifetime cap on any call entry; and `startCall` now **takes over** a stale entry instead of returning 409. With the sweep wired to the presence tracker, a leaked entry can no longer exist.
  - **One disconnected session killed the other session's live call.** The WebSocket gateway tore down all of a user's active calls whenever ANY of their sockets closed — closing a second tab, a phone sleeping, or a transient reconnect dropped the user's other session straight into a call the server had already deleted; every further signaling message 404'd and the call died as "Call failed". The gateway now cleans up only when the user's **last** realtime session (WS or SSE) is gone, using the presence tracker.
  - **A redial during the ring failed with 409.** If the caller's browser refreshed mid-ring, the server kept ringing for up to 60s while the caller's screen was gone — and redialling in that window returned `409` → "Call failed". A redial from the same caller now **resumes the same ringing call** instead.
- 🧭 **The failure now explains itself.** When the media path (ICE) genuinely cannot connect — the remaining physical cause, typically a restrictive network such as carrier/home NAT without a TURN relay — the call screen now shows a hint under "Call failed" pointing at the one-command fix (`scripts/setup-turn.sh`), in English and Persian, instead of a dead end.

### Tests

- 9 new server tests: reaper lifecycle (grace window, online participant, lifetime cap, log semantics), stale takeover, redial resume, and the gateway's last-session-only cleanup. Full suites: server 1230, client 406, worker 35 — all passing.

## 1.3.0-dev.3

### Changed

- 🔢 **The version scheme now carries all the way up — no component ever shows two digits.** The previous carry rule stopped one level short: `1.9.0-dev.9` computed the next release as `1.10.0-dev.1`, breaking the promise that nothing above 9 ever appears (and scrambling GitHub's alphabetical tag ordering again, since `1.10.x` sorts before `1.2.x`). The law is now a proper positional carry, like odometer digits:
  - minor, patch and the dev counter are each a **single digit** (0..9; counter 1..9). The major grows freely — it has no left-hand component to carry into, so it is the only place a "10" may ever appear.
  - `1.2.0-dev.9 → 1.3.0-dev.1` (counter carries into minor), **`1.9.0-dev.9 → 2.0.0-dev.1`** (minor overflow carries into major).
  - The release-sync gate rejects any two-digit minor/patch/counter, the promote workflow validates the same shape, and `scripts/test/version-sync.test.bats` pins all of it (carry into minor, carry into major, two-digit rejections).
  - Two promote-workflow defects fixed on the way: the stable-tag collision check tested an **undefined `STABLE_TAG`** variable (it never fired, and the later `git tag` step would have failed with an empty tag), and a second promotion inside one dev series now **bumps the stable base with the same carry law** (`1.2.1 → 1.2.2`, `1.2.9 → 1.3.0`, `1.9.9 → 2.0.0`) instead of erroring out.
- 📄 **Project identity cleanup + proprietary license.** A full-tree sweep found no remaining functional references to the original upstream project outside the LICENSE attribution (the one historical changelog mention was reworded; the upstream name now exists only where the MIT license legally requires it — the third-party attribution paragraph in LICENSE). The project no longer presents itself as open-source: LICENSE replaced with a proprietary MASolutionExpert license (self-hosting your own instance stays permitted; redistribution does not), all `package.json` files switched to `UNLICENSED`, the README badges and License sections (EN + FA), the docs-site footers (EN + FA) and the in-app About panel text (EN + FA) now say proprietary.

## 1.3.0-dev.2

### Added

- 📞 **Call-history report in the admin panel.** The Chats (گفتگوها) tab now has a "Call history" sub-view showing every voice and video call in the instance — caller (avatar/username/nickname), chat, type (voice/video), outcome (answered / outgoing / cancelled / declined / missed / failed), duration and exact time — with search across callers, participants and chats, type/outcome filters, sortable columns, mobile cards + desktop table, and server-side pagination. Backed by the new admin-only `GET /api/admin/calls` endpoint over the existing call-log messages (encrypted user-typed look-alikes can never appear in the report). Full fa/en i18n.
- 🛡️ **One-click TURN relay deployment for 10/10 call quality** (`scripts/setup-turn.sh`). STUN alone cannot connect peers behind symmetric NAT (most mobile carriers); those calls only work through a TURN relay. The new script installs and configures coturn on the ChatDesk host (auto-detects the public IP, generates credentials, opens firewall ports) and wires `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` into the server's `.env` — existing non-empty TURN values are never overwritten. With a relay available, ICE picks the fastest usable path per call and essentially every call connects.

### Changed

- 📶 **Calls now self-heal instead of dying.** When the media path drops (Wi-Fi ↔ mobile data switch, brief network outage), the peer connection previously went straight to "Call failed". The client now attempts one automatic ICE restart with a 10-second recovery window before giving up — transient network switches no longer kill the call. Both sides may attempt the restart simultaneously; the existing perfect-negotiation offer-collision handling resolves the overlap safely. Timer cleanup covers all exit paths (hang-up, failure, unmount, ring-ended).

## 1.3.0-dev.1

### Added

- 🔢 **Engineered version scheme: no more two-digit dev counters.** Dev prereleases used an open-ended counter (`1.2.0-dev.10`, `dev.11`, …), which scrambled GitHub's alphabetical tags/releases ordering (`dev.10` sorts before `dev.2`). The dev counter is now a single digit 1–9; when the next increment would reach `.dev.10` it **carries into the minor version** (`1.2.0-dev.9` → `1.3.0-dev.1`), so alphabetical tag order always equals chronological order. Enforced end-to-end: `scripts/next-dev-version.sh` is the canonical next-version calculator, the release-sync gate rejects any version with a dev counter above 9, and the `chatdesk-deploy` CLI's `dpkg --compare-versions` comparisons remain fully compatible with the scheme. This release is the first to use it: the call-stability work previously staged as `1.2.0-dev.10` ships as **1.3.0-dev.1** (same commit content, clean order).

### Fixed

- 📞 **Calls no longer fail or get stuck — the whole call system was reworked for stability.** After re-enabling calls, every attempt surfaced "Failed call" and callee sessions could stay stuck on the ringing screen, silently auto-rejecting every later call as busy. Root causes and fixes:
  - **Circular-JSON 500 on every accept** (`CALL_MAX_DURATION` set): the max-duration timer handle lived inside the call object, and `POST /api/calls/accept` serialises that object — Node throws on the circular reference and the accept dies. Timers now live outside the call objects in dedicated maps.
  - **Stuck ringing on multi-session accounts**: when a call was accepted/declined/ended on one device, the account's OTHER sessions kept ringing forever and auto-rejected every future call as busy ("Failed call" at dial time). The server now broadcasts `call:ring-ended` to every session of both participants on accept/reject/end/disconnect, and the client leaves the ringing screen when it arrives.
  - **Rings never timed out**: an unanswered call now ends server-side after 60s with a `missed` log entry, a push dismissal, and a "No answer" notice on both sides — instead of ringing forever.
  - **Doomed rings surfaced as failures**: calling someone already in a call now returns `409 callee_busy` before ringing (WS + HTTP), and the caller sees «خط اشغال است / Line busy» instead of "Call failed".
  - **Unsupported clients no longer kill calls**: a session on insecure HTTP / without WebRTC no longer auto-rejects an incoming call (which ended the call for every device of that user); the server's ring timeout is the single authority.
  - **Declined ≠ failed**: call-log semantics were split properly — outgoing / connected / cancelled (caller hung up) / declined (callee rejected) / missed (nobody answered) / failed (technical fault) — with rose styling for never-connected calls and full i18n (fa/en) for call screens and call-log labels, which were previously hardcoded English.
- 🧪 New API test suite for `/api/calls` (84 call-system tests green); full suites re-run: server 1206, client 406, worker 35 — all passing.

## 1.2.0-dev.9

### Fixed

- 🐛 **Picking any action in the message context menu kicked you out of the chat.** After tapping حذف (delete) or forward — whether you completed the action or cancelled it — the app exited the open chat and landed back on the chats list, in every chat and thread. Root cause: when a menu item opened a follow-up dialog (delete-scope, forward), the menu's deferred `history.back()` found the dialog's history entry on top and skipped its own pop, leaving an orphaned `{sbContextMenu: true}` sentinel in the history stack between the chat's entry and the dialog's. When the dialog later closed, its pop landed on that orphaned entry, and the open chat's `useOverlayBack` handler — whose guard only recognised its own key — misread it as a genuine back gesture and called `closeChat()`.
  - Fix in the shared `useOverlayBack` hook: sentinel ownership is now tracked in a module-level registry, so a pop that lands on any overlay's **stale** sentinel (owner already closed without popping) is treated as internal bookkeeping — not a back gesture — and the stale entry is disposed automatically with a follow-up `back()`. Works for every overlay that opens on top of a closing one, not just the context menu.
  - Regression tests: the existing "opening a modal while the context menu closes in the same commit keeps the modal open" suite still passes; no overlay closes unexpectedly when a sibling overlay's stale sentinel is popped.

### Changed

- 🛡️ **Message editing is now a moderator-only capability.** Regular users (نقش user) can no longer edit messages — the ویرایش entry no longer appears in their message context menu, and both server edit paths (`POST /api/messages` with `editMessageId`, and `POST /api/messages/edit`) return 403 `Only moderators can edit messages.` for the `user` role, even on their own messages. Owner/admin/operator keep editing their own messages exactly as before.

## 1.2.0-dev.8

### Fixed

- 🐛 **Nobody could delete a message — the confirm dialog flashed and vanished instantly.** Clicking "حذف" in the message context menu closed the menu and opened the delete-confirmation dialog in the same instant. The menu's own "system back" bookkeeping called `history.back()` while the dialog was pushing its history entry, and the resulting `popstate` closed the freshly opened dialog a split second later — on some browsers the push itself was even swallowed. Result: a dialog that "appeared and immediately disappeared", so **neither side of a chat could ever delete a message** (the same flash hit every dialog opened from a context menu: delete, forward, delete chat).
  - Fix in the shared `useOverlayBack` hook: the close-pop is deferred one tick and re-checks that its own history entry is still the topmost one before popping, plus a `popstate` guard so a sibling overlay's back() can never close a newer overlay. Deferred entries are drained naturally by later back gestures.
  - Regression test added (chromium + firefox): "opening a modal while the context menu closes in the same commit keeps the modal open".

### Added

- 🛡️ **Deletion is now a moderator-only power, with a full audit trail in the Reports (Logs) section.**
  - **Regular users can no longer delete messages** — not even their own (`POST /api/messages/delete` returns 403 for the `user` role). The delete entry no longer even appears in their message context menu.
  - **Regular users can no longer delete threads.** DM-type chats (support tickets are DM chats) are protected server-side (`POST /api/chats/hide` returns 403), and the delete entry / edit-mode remove button is hidden for them. Group/channel cleanup (leave + hide) keeps working exactly as before.
  - **Admins and operators keep full deletion powers** — an operator/admin can now even delete another participant's message "for everyone" inside threads they belong to (previously only the message author or the chat owner could).
  - **Every moderator deletion is logged to the admin audit log** and shows up in the admin panel **Logs tab (گزارش‌ها)** with the actor, timestamp, and details:
    - `message.delete.everyone` — message deleted for everyone (with a short preview of the deleted text);
    - `message.delete.self` — message hidden from the moderator's own view;
    - `thread.delete` — a thread (DM/support chat) removed from view;
    - `chat.delete` — a group/channel destroyed (with its files). File deletion happens through message/thread deletion, so those events are covered by the same entries.

### Security

- 🔐 The policy is enforced **server-side**, not just hidden in the UI: both delete endpoints verify the acting user's role from the database on every request. Regular users cannot bypass the block by crafting requests, and moderators cannot delete outside chats they are a member of (membership checks unchanged).

### Tests

- 🧪 Server suite **1200/1200** green (new: regular-user 403 on both delete scopes, moderator deletes audited with exact action/actor/details, thread-deletion policy for DM vs group, regular-user group hide still allowed). Client unit suite **406/406** green. New browser tests: overlay-back regression (chromium + firefox) and the context-menu delete policy (5 cases). ESLint clean on all touched files.

## 1.2.0-dev.7

### Added

- 🔍 **Per-thread Search — full-history search inside every conversation (profile "Search" action, next to "Files").** Operators can finally find any past message in a thread with a user:
  - searches **any character, word or number** — case-insensitive, literal (typing `%` or `_` finds those characters, no wildcard surprises);
  - matches **message text from BOTH sides** of the thread (including edited text) **and attachment file names**;
  - every result row shows the sender's nickname, the message text with the **match highlighted**, and the full original timestamp (date · time) — clicking a row jumps to the message in the chat (same scroll + flash as the files gallery / reply quotes);
  - "Load more" pagination and a live result counter in the header; debounced input, keyboard-accessible, focus-trapped dialog consistent with the Files gallery design.
- 🌐 i18n fa/en (`modals.threadSearch.*`, `modals.profile.search`) — Persian UI fully translated.

### Security

- 🔐 The search is **members-only** and uses the exact same visibility contract as the files gallery: `GET /api/chats/:chatId/search` requires a session whose username matches the `username` parameter, verifies chat membership (403 otherwise), and messages hidden for everyone — or hidden for the requesting viewer — **never match**. System messages are excluded. No cross-thread or cross-user leakage is possible; operators can only search threads they belong to. (Also re-audited after the dev.6 client-filter removal: all message/file access paths remain gated by server-side membership checks — removing that filter introduced no security hole.)

### Implementation notes

- 💬 Message bodies are **encrypted at rest** (sb-enc-v1, random IV), so SQL `LIKE` cannot match plaintext. The search chunk-scans the thread (500 rows per chunk), decrypts bodies in the app layer, and filters in JS — newest first, with a 50,000-row scan cap so a huge thread can never pin the server. Attachment file names are matched via one batched query per chunk.
- 🧪 Tests: `server/test/db/chatSearch.test.js` (11 cases: both sides, case-insensitivity, single chars/numbers, file-name matches, literal wildcards, system-message exclusion, hidden-for-everyone / viewer-hidden contracts, pagination, empty terms, cross-thread isolation) and `server/test/api/chatSearch.test.js` (auth, pagination, 400/403 contracts) — full server suite **1194/1194** green. New browser suite `ChatSearchModal.test.jsx` (chromium + firefox: typing → results → jump, empty state). Client unit suite 406/406 green; ESLint clean; production client build OK.

## 1.2.0-dev.6

### Fixed

- 🔎 **"کاربری یافت نشد" on ID search — the real root cause (client-side), fixed at last.** Deep diffing against the upstream codebase this project forked from (see LICENSE for attribution) proved the server search chain (`/api/users` route + `searchUsers` SQL) is identical to upstream and works on PostgreSQL — confirmed by `search:doctor` probes on live servers. The breakage happened in the client, one layer above the SQL:
  - The new-DM modal filtered search results through a hidden "existing DM partners" list (`useDmUsernames` → `dmUsernamesRef`), so anyone the searcher already shared a chat with was silently removed and the modal reported "کاربری یافت نشد" for people who obviously exist.
  - **Why it appeared after the ChatDesk changes**: upstream has no helpdesk. ChatDesk stores support tickets as `type: "dm"` chats with `channel: "support"`, so every ticket partner was added to that hidden list too — on helpdesk servers the hidden set covers essentially every user, and every search came back empty. (The upstream filter only hid plain messenger DM partners; ChatDesk inflated it.)
  - **Fix**: the filter is removed entirely. The search now shows every match; starting a chat with someone you already chat with simply re-opens the existing conversation (`POST /api/chats/dm` reuses it — no duplicates), and support-thread partners are searchable again like any other user. `useDmUsernames` was dead code after this and has been deleted.
  - Searching an ID that matches nobody still says "کاربری یافت نشد" — correctly, because the account really does not exist.

### Tests

- 🧪 `useNewChatSearch.atStrip.test.jsx` updated: results now must include existing chat partners (chromium + firefox); the old "partners are filtered" assertion is inverted. Client unit suite 406/406 green; ESLint clean on the touched files.

## 1.2.0-dev.5

### Diagnostics

- 🩺 **`npm run search:doctor`** — new read-only search diagnostic (same discipline as `db:doctor`; never imports db.js, never writes). When the app says "کاربری یافت نشد" for every ID, it pinpoints WHERE the chain breaks on the live server:
  - connected engine, and for PostgreSQL the `server_encoding` / `lc_collate`;
  - the REAL contents of the users table — usernames (flagging mixed-case ones that lowercase-based login/search can never reach), nicknames, roles, bans;
  - the search SQL run twice against the live DB — the OLD raw-LIKE query (pre 1.2.0-dev.4) vs the NEW `lower()`-based query — so "OLD empty but NEW matches" instantly proves the server is still running pre-dev.4 code (update not applied / install tracking the stable channel);
  - probe terms: passed as arguments (`npm run search:doctor @milad ahmadi`) or derived from the stored users.
- 📋 `GET /api/users` now emits a dedicated `[app-debug] api:users:search` log line (query, exclude, matched count, elapsed ms) when APP_DEBUG is enabled — complements the generic `api:request` logging for pinpointing search issues in production.

### Verification

- 🧪 Full server suite 1177/1177 green; `search:doctor` validated end-to-end in the sandbox against a real migrated SQLite database (users registered through the API, doctor run with derived and explicit probes, `@`-prefixed probe correctly demonstrated as OLD-SQL-empty / NEW-SQL-matched).
- 🔬 Search SQL semantics additionally proven against PostgreSQL semantics via pg-mem: the pre-dev.4 raw-LIKE query fails for mixed-case nicknames under PG case-sensitivity while the dev.4 `lower()` query matches.

## 1.2.0-dev.4

### Fixed

- 🔎 **"کاربری یافت نشد" on every ID search in the new-direct-message dialog** — the user search was broken on production deployments in two independent ways, both fixed in the shared search layer (`searchUsers` / `searchPublicGroups` / `searchPublicChannels` in `server/db.js`):
  - **PostgreSQL case-sensitivity**: Postgres `LIKE` is case-sensitive (SQLite's is not, which is why it worked in dev). A search for a mixed-case nickname ("Alice") or group/channel name ("Support Team") with a lowercase query matched nobody. All comparisons now run through `lower()` on both engines — the search is case-insensitive everywhere.
  - **The "@" prefix**: users habitually type `@id` when searching an ID; the old pattern `%@bob%` never matches the stored `bob`, so every ID search returned an empty list. Leading `@` characters are now stripped from the search term server-side (all consumers: `/api/users`, `/api/discover`, group/channel discovery, member pickers, admin panel) and in the client hooks (`useNewChatSearch`, `useDiscoverSearch`) as defense in depth.
  - A term that is empty after stripping (`@`, whitespace) matches nothing instead of falling back to a full-table scan.
- 🧪 Regression suites: `server/test/db/userSearch.test.js` (17 cases: `@` stripping, case-insensitive username/nickname/group/channel matching, empty-term no-match, exclusion) and browser hook suite `useNewChatSearch.atStrip.test.jsx` (chromium + firefox: `@bob` → `bob`, case folding, DM-list filtering).

## 1.2.0-dev.3

### New

- 📁 **Per-thread "Files" gallery** — the profile panel (the page with Chat / Call / Video / Mute) has a new **Files** action. Opening it shows EVERY file shared in that thread by BOTH sides, newest first:
  - each row shows the media thumbnail (image/video poster) or a kind icon (video / audio / document), the file name, its size, the sender's nickname, and the **full original timestamp (date · time)** of the message that carried it;
  - every row has an **options menu**: **Open** (new tab), **Download**, and **Go to message** (closes the gallery and scrolls to the original message with the reply flash);
  - videos still transcoding are marked "Processing"; long threads paginate with a "Load more" button; a counter in the header shows the total number of shared files;
  - works for DMs, groups and channels (the own-thread profile only — member/mention mini-profiles don't offer it), fully localized (fa/en), Persian-aware fonts.
- 🔌 New members-only endpoint `GET /api/chats/:chatId/files` (session + membership enforced) with a dedicated db layer: `listChatFilesForUser` / `countChatFilesForUser`. Messages hidden for everyone — or hidden for the requesting viewer — never leak their files. Local files resolve to the local upload URL; remote/S3 files get presigned URLs; thumbnails resolve through the shared `resolveThumbUrl` logic (app-encrypted thumbs go through the decrypting proxy).

### Tests

- 🧪 `server/test/db/chatFilesGallery.test.js` (both sides listed newest-first, hidden-for-everyone and viewer-hidden filtering — which caught and fixed a `Number(uuid)` NaN bug in the viewer filter — and pagination) and `server/test/api/chatFiles.test.js` (member 200 + payload shape, 403 non-members, 400 missing username, pagination/hasMore, presigned remote URLs).
- 🧪 Browser suite `ChatFilesModal.test.jsx`: rows with sender/size/timestamp, empty state, per-row options menu (jump-to-message callback), load-more button.

## 1.2.0-dev.2

### Changed

- 🏷️ **SUPPORT / MESSENGER channel badges replace the red-headset marker** (follow-up to 1.2.0-dev.1, feedback-driven redesign): the channel of every conversation is now marked with a clean text pill —
  - **SUPPORT** (rose pill) on helpdesk threads opened through the department picker;
  - **MESSENGER** (slate pill) on messenger-style direct chats.
  - Badges appear in the chat list (DM rows), the chat window header (with the department name in the tooltip), on every incoming message's timestamp row (SUPPORT and MESSENGER, symmetric marking), and in the admin panel's Chats tab (mobile cards + desktop table).
  - New shared component `ChannelBadge` replaces `SupportChannelBadge`; tooltip labels localized (fa/en), LTR-pinned for RTL layouts.

### Fixed

- 🔒 **Channel-separation leak closed in the "find user by ID → send message" flow** (`POST /api/chats/dm`): it previously looked up ANY DM between the pair — including an existing **support ticket** — so a plain direct message could land in (and resurrect) the ticket thread. It is now strictly scoped to the pair's `direct` chat and creates a fresh `direct` chat when none exists; the support thread is never touched. The response now also reports `channel: "direct"`. Route-level regression suite added: `server/test/api/channelSeparation.test.js` (asserts `findDmChat` receives `{ channel: "direct" }` / `{ channel: "support", departmentId }` on both flows).
- 🧪 De-flaked `server/test/db/supportChannel.test.js`: the legacy unfiltered `findDmChat` lookup orders by random UUID ids, so its result set was non-deterministic; the test now asserts membership across all of the pair's DM threads.
- 🧪 Browser badge suites (`MessageItem`, admin `ChatsTab`) re-pinned to English via `LanguageProvider` + `chatdesk.uiLanguage` — they had been red since the Persian-default UI change (99fe1dd) and are green again.

### Rules

- 📐 `AGENTS.md` sandbox discipline: work known to be un-installable/un-testable in the sandbox is skipped outright; every check the sandbox CAN run (lint, unit/integration/API tests, installer bats, release-sync gate) MUST be run.

## 1.2.0-dev.1

### New

- 🎫 **Direct messages and support tickets are now two strictly separated, visually distinguishable message types** (migration 044: `chats.channel`):
  - Every conversation is explicitly either **`direct`** (messenger-style, opened by finding a user's ID) or **`support`** (a helpdesk thread opened through the department picker).
  - A support request **never reuses or converts a direct chat** between the same customer and operator anymore — previously it could silently convert an existing messenger chat into a support thread. It only continues an existing support thread for the *same* department; different departments get separate threads.
  - 🔴 New **red headset badge** (`SupportChannelBadge`) marks support-channel threads everywhere: in the chat list (both sides), in the chat header (with the department name in the tooltip), and on every incoming message bubble's timestamp row — so an operator can tell at a glance "this message came from the user via the support section". The sky-blue verify badge (verified identity) and role badges are unchanged and remain distinct markers.
  - Realtime: `chat_message` SSE/WS payloads now carry `chatChannel`, so badges are correct even for freshly created support threads.
  - 🧑‍💼 **Admin panel → Chats**: new "Message Channel" column (Direct messages / 🔴 Support tickets) **and** a new channel filter (All channels / Direct messages / Support tickets) on both desktop table and mobile cards; support rows also show the department name.
- 🧪 New test coverage: `server/test/db/supportChannel.test.js` (channel defaults, department tagging/demotion, strict channel separation in `findDmChat`, `listChatsForUser` channel fields, `adminListChats` filtering) and browser tests for `SupportChannelBadge`.

## 1.1.0-dev.11

### Fixed

- 🏷️ **Update detection could think dev.10 is OLDER than dev.9** — both version comparators (server and client) compared the prerelease part as a plain string, so `"dev.10"` sorted before `"dev.9"`. From dev.10 onward the in-app updater would have offered dev.9 as "newer". Prerelease identifiers now compare per SemVer rules (numeric identifiers numerically), and the GitHub tag fetch paginates (up to 3×100 tags) so the newest release is never missed on a long tag list.
- ⏯️ **`DB_MIGRATION_TIMEOUT_MS=0` now actually disables the migration watchdog** as documented — previously the `0` fell through the `> 0` guard and silently re-enabled the 120s default. A blank value is treated as unset (it can never accidentally disable the watchdog).
- 🩺 **`db:doctor` is now truly read-only** — it no longer imports `server/db.js`, which silently ran the full migration bootstrap (mutating the database from a "diagnostic" tool, without the running-server guard that `db:migrate` has). It reads the schema version directly; the "migration(s) pending" warning is now actually reachable and meaningful.
- 💾 **`pg_dump` pre-migration backup can no longer freeze the updater** — the dump now runs with a hard time limit (`DB_BACKUP_TIMEOUT_MS`, default 120s) and `PGCONNECT_TIMEOUT`, and a timed-out dump is cleaned up instead of leaving a partial file.
- 🚪 **`db:migrate` exits immediately in Postgres mode** — the idle connection pool is destroyed after completion, so the updater no longer pauses ~30s at the end of migrations while the pool times out.
- 🔐 **`POSTGRES_SSL=true` is now honored when the target is a `POSTGRES_URL`/`DATABASE_URL`** (self-signed Postgres servers); an explicit `sslmode=` inside the URL still wins.
- 📜 **Installer: streaming migration output no longer hits "Permission denied"** when `chatdesk-deploy` is run through sudo — the install log is handed to the invoking user and the streaming `tee` falls back to `sudo -n tee` if the log is not writable.

## 1.1.0-dev.10

### New

- 🩺 **Database hardening** — the database layer now fails fast instead of hanging forever, even though the data itself is tiny. This release was built after an update stalled for a long time at "Running database migrations" on a database with only 2–3 accounts: the stall was never about data size, it was the database layer having **no timeouts at all** in Postgres mode (a single unreachable/locked/stalled query could hang forever, and one update involves hundreds of queries).
- 🧪 New **`db:doctor`** diagnostics command (menu: Manage Database → "Database diagnostics (db:doctor)") that reports the engine and connection target, connection latency, schema version vs. latest migration, missing critical tables, leftover interrupted-migration rebuild tables, row counts, database size, and (SQLite) integrity check + WAL health.

### Fixed

- ⏱️ **Fail-fast timeouts everywhere in Postgres mode**: TCP connect (10s), pool acquire (15s), per-statement `statement_timeout` (30s) and `idle_in_transaction_session_timeout` (30s), pool `min: 0` so dead servers are not propped up by stale sockets. Every value is overridable via `DB_CONNECTION_TIMEOUT_MS`, `DB_ACQUIRE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` for large datasets.
- 🚦 **Connectivity preflight before migrations**: 3 quick `SELECT 1` probes with a clear, actionable error naming the exact cause (server not listening / DNS / credentials / SSL / timeout) and the configured target — nothing is modified when the database is unreachable, instead of a silent chain of 60s+ stalls.
- 🛑 **Per-migration watchdog** (`DB_MIGRATION_TIMEOUT_MS`, default 120s): a single migration that refuses to finish is aborted with an error that names the migration and explains that schema version was not advanced — no more frozen "Running database migrations".
- 💾 **Automatic pre-migration backup for Postgres too** via best-effort `pg_dump` into `data/backups/` (SQLite keeps its file-copy backup); a missing `pg_dump` warns instead of blocking.
- 📺 The updater now **streams migration output live** (every migration with its number and elapsed time) instead of capture-and-show-later output that looks frozen; a 15-minute hard ceiling (`DB_MIGRATION_MAX_SECONDS`) force-stops a stuck migration with a pointer to `db:doctor`.

## 1.1.0-dev.9

### Fixed

- 🐢 Update stuck on "Running database migrations": the migration runner re-applied all 43 idempotent migrations on **every** update and every server boot ("self-heal"), which on large databases silently burned minutes with zero output — it looked frozen. The self-heal pass now runs only when a critical table is actually missing (cheap existence check), the schema version prints correctly (previously `[object Promise]`), and each applied migration logs its number and elapsed time so progress is always visible.
- ⌨️ Pressing Ctrl+C during the migration step of an update left the stopped ChatDesk service down behind nginx (**502 Bad Gateway**) — the interrupt handler now automatically restores the service before exiting, in addition to the existing recovery on every other interrupted update path.

### Changed

- 🧭 The updater now warns before migrations that large databases can take several minutes and that interrupting the step can corrupt the schema; migration output streams live instead of staying silent.

## 1.1.0-dev.8

### Changed

- 🧹 Project cleanup: removed the original upstream project's leftovers — the old maintainer's personal email/LinkedIn/Telegram/Railway links (Security Policy, Code of Conduct, Accessibility statement, docs site social links, in-app About panel) now point to the ChatDesk GitHub project; removed the dead `opencode.json` AI-tool config and the graphify/Superpowers sections from `AGENTS.md`; dropped the stale static `1.0.0` version badge from the READMEs and fixed `CONTRIBUTING.md` to route contributions into `dev` (two-channel law). The MIT `LICENSE` retains the original author's copyright line as legally required.

### New

- 📌 The release delivery checklist (installer/CLI sync law) is now recorded as permanent memory in `AGENTS.md` — every future change must pass the release-sync gate, update the installer header, and be registered as a bilingual dev release before being reported. The two-channel mechanism is now also documented in the deployment guide (English and Persian).

## 1.1.0-dev.7

### Fixed

- 🧰 Installer & CLI versioning was broken: the `chatdesk-deploy` CLI stamped its own version with a `sed` pointed at the wrong line, and the installer header (`chatdesk-deploy-version`) had not been bumped since dev.2 — so installed CLIs never self-updated and servers stayed on old versions even after updates. The header is now bumped with every release and stamped correctly; a CI gate (`verify-release-sync.sh`) refuses any push where VERSION, the installer header and CHANGELOG disagree, so this can never drift again.
- 🔀 Update checks are now channel-aware: a Stable-channel install is only offered stable releases and a Test-channel install follows dev prereleases — previously the app mixed both channels when showing "update available".

### New

- 🚦 Two-channel DevOps pipeline end to end: `chatdesk-deploy --status` shows the installed version and channel; the menu banner shows the same; a new **"Switch Test (dev) / Stable (main) channel"** menu action moves an install between channels through the full update pipeline; and a new **"Promote dev to Stable"** GitHub Actions workflow is the single user-triggered path from an approved dev tag to a stable release on `main`. All install/update/channel-switch paths now share one finalization pipeline (dependencies, migrations, client build, CLI sync, systemd, restart, health check).

## 1.1.0-dev.6

### Fixed

- 🛠️ Helpdesk: admin panel department endpoints crashed with an internal error (`ReferenceError`) because the helpdesk database helpers were never wired into the admin panel module — the Helpdesk tab showed "Could not load helpdesk data", department creation failed, and the support picker could not list departments. All department and support-report endpoints now work end to end.
- ➕ The "+" menu in the sidebar now lists "Contact support" first (then private message, group, channel) to match the support-first workflow.

## 1.1.0-dev.6

### Fixed

- 🔧 Installer (CLI Update): the updater stops the ChatDesk service before doing any work, but many failure or early-exit paths (failed dependency install, failed client build, failed migration, failed `git fetch`, aborted prompt, even the "already up to date" exit) returned without restarting the service — leaving the site permanently behind nginx as **502 Bad Gateway**. The updater now restores the service automatically on every interrupted path and verifies the health endpoint after restarting, with clear `journalctl` hints when it cannot come up.

## 1.0.0

First independent release of ChatDesk.

### New Features

- 🎧 Helpdesk mode: departments, operator role and fair routing of support requests
- 🏢 Department picker during customer registration; conversations start in the right queue
- ⚖️ Fair assignment strategies (round-robin / least-busy) for incoming support requests
- 🛡️ Admin panel extensions: operator account management, department management and reports
- 🗂️ Request status, assignment, tags and customer-invisible internal notes
- 🌐 Bilingual (English / Persian) setup guide and documentation
- 🚀 Branch-aware deployment installer with PostgreSQL as the default database

### Inherited Platform Features

- Messenger core: direct messages, groups and channels with realtime SSE
- File uploads, voice messages and video transcoding worker
- Web push notifications (VAPID) and voice/video calls
- Remote channels (Telegram / ChatDesk mirroring)
- Owner admin panel, PWA support and encryption at rest
