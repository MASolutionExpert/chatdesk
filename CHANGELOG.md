# Changelog

All notable changes to ChatDesk are documented in this file.

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

- 🔎 **"کاربری یافت نشد" on ID search — the real root cause (client-side), fixed at last.** Deep diffing against upstream Songbird (v0.13.3 and current main) proved the server search chain (`/api/users` route + `searchUsers` SQL) is identical to upstream and works on PostgreSQL — confirmed by `search:doctor` probes on live servers. The breakage happened in the client, one layer above the SQL:
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
