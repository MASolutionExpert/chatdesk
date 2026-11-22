# Changelog

All notable changes to ChatDesk are documented in this file.

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
