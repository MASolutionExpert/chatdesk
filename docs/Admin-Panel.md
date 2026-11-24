# Admin Panel

The Admin Panel provides a web-based interface for managing users, chats, runtime settings, and system operations. It's accessible to users with the **owner** or **admin** role.

## User Roles

- **Owner**: Full access to admin panel and all features
- **Admin**: Limited access to admin panel
- **User**: Regular user with no admin access

:::warning

Only one user with owner role can exist at a time.

:::

## The Owner Account (system owner)

The **first user registered on a fresh installation automatically becomes the owner** of the whole system (role `owner`). The owner has full access to every feature of ChatDesk — admin panel, settings, departments, and every capability an admin has.

The owner account is **permanently protected**:

- No admin (and no other user, and not even the owner through the admin panel) can **edit, ban, delete, re-role, or password-reset** the owner account. Every such attempt through the app is refused with `403 owner_protected`.
- A second owner can never be promoted while an owner exists.
- The **"What's new" feature** (the per-version changelog popup shown on each new release and the "What's new" entry in Settings) is a privilege of the owner alone — no other account ever sees it.

Changes to the owner account (username, role transfer, password, ban state, …) are only possible from the **server's interactive menu** (`chatdesk-deploy` → Manage Database → Edit user), which runs directly on the server outside the web surface:

```bash
chatdesk-deploy
# Navigate to "Manage Database" → "Edit user"
# Select the owner account and change what you need
```

The owner can still manage their own profile (nickname, avatar, own password) from the in-app profile page — that is self-service, not an administrative change.

## Accessing the Admin Panel

There are two primary ways to grant an account **owner** or **admin** privileges:

### Option 1: CLI / Deployment Script (VPS & Shell Deployments)

1. Create or edit a user and give them the **owner** or **admin** role (prompted on fresh install, or later via the [Deployment Script](./Deployment-Script.md)):

  ```bash
  chatdesk-deploy
  # Navigate to "Manage Database" submenu
  # Select "Create user" or "Edit user"
  # Follow prompts and select either "owner" or "admin" role
  ```
  :::info You can also use [database commands](./Database-Commands.md) if you prefer:

   ```bash
   cd /opt/chatdesk/server
   # If you want to create a new user
   npm run db:user:create
   # Or if you want to promote a user
   npm run db:user:edit
   # Follow prompts and select either "owner" or "admin" role
   ```
  :::

2. Log in to your ChatDesk instance with the promoted account.

3. Click the **Admin Panel** button in the sidebar (accessible only by owner and admins).

### Option 2: Emergency Admin & Owner Claim (PaaS & Web UI)

For deployments on PaaS providers (such as Render, Railway, or Fly.io) or container platforms where terminal access is unavailable, authenticated users can claim privileges directly via the web UI:

1. Configure `ADMIN_API_TOKEN` in your environment variables (e.g., in your PaaS dashboard settings). If not set, ChatDesk auto-generates a token on first boot and saves it in `.env`.
2. Log in to your registered user account.
3. Open your browser and navigate directly to `/admin`.
4. Enter the `ADMIN_API_TOKEN` in the Emergency Admin Access prompt.
5. Click **Claim Privileges**.

:::info When the claim form is visible
The Emergency Claim form is strictly gated — the client only renders it when the server reports a genuine lockout (`GET /api/app/info` → `adminClaimAvailable: true`, meaning **`ADMIN_API_TOKEN` is configured AND no admin/owner exists**). In every other state — a healthy installation, a regular user browsing to `/admin`, or a monitoring session minted through "Log in as user" — the page shows **Access denied** with no token prompt at all. The claim endpoint additionally enforces a strict rate limit of **10 attempts per 15 minutes per IP**, so the token cannot be brute-forced.
:::

:::info Privilege Promotion Rules
- **First Claim (Owner)**: If no user currently holds the **owner** role, the claiming user is promoted to **owner**.
- **Subsequent Claims (Admin)**: If an owner already exists, claiming privileges promotes the user to **admin**.
:::

:::warning HTTPS Required
Emergency Admin Claim requires a secure connection (HTTPS) or local loopback (`localhost`, `127.0.0.1`, or `::1`). Unencrypted HTTP connections on remote hosts will block the claim feature.
:::

:::danger Security Caution
Do not share `ADMIN_API_TOKEN` and keep it private. Anyone can access the admin panel by using this token.
:::

## Dashboard Tab

The Dashboard provides an overview of your ChatDesk instance:

- **Statistics**: Total users, chats, messages, and uploaded files
- **System Info**: Uptime, and environment
- **Storage**: Database and upload directory size

## Users Tab

Manage all users in your ChatDesk instance:

### Features

- **View All Users**: Paginated List with sorting and filtering
- **Create Users**: Create new accounts with username, nickname, password
- **Edit Users**: 
  - Update username, nickname, avatar
  - Reset password inline
  - Change user role (admin/user)
  - Ban/unban users
- **Log in as user (owner only)**: The system owner can click the login button on any user row and enter the app as that user, without their password — for supervision and monitoring. Security details:
  - Enforced server-side: any non-owner session is rejected (`owner_only`).
  - The owner account itself, banned users and self-impersonation are refused.
  - The owner's real session is parked in an HttpOnly cookie; an amber banner appears in the app with a **Return to admin panel** button that restores it.
  - Monitoring sessions cannot open `/admin` — the app redirects them back to the chat, so pressing the browser **Back** button after entering a user's panel can never land on admin pages or the emergency claim form.
  - Logging out while monitoring destroys **both** sessions — the impersonation session and the parked owner session — and clears both cookies.
  - Every impersonation and return is recorded in the admin audit log (`user.impersonate`, `user.impersonate_return`).
- **Delete Users**: Permanently remove user accounts
- **Search & Filter**: Searching and filtering across the entire users dataset

## Chats Tab

Manage DMs, groups, and channels:

### Features

- **View All Chats**: Paginated list with type, member count, message count, and creation date
- **Time Filter**: From/to date inputs with **Today / Last 7 days / Last 30 days / All time** presets (the same filter as the helpdesk report) — filters the list by chat creation date
- **Create Chats**: Create a new group or channel
- **Edit Chats**: Update chat metadata and its ownership
- **Delete Chats**: Permanently remove chats and all associated messages
- **Search & Filter**: Filtering across all chats — the **Chat Type** filter offers Direct messages, **Support messages** (the helpdesk ticket threads), Groups and Channels, plus privacy, verification, auto-add and remote-channel filters
- **Sorting**: Sort by Name, Type, Visibility, Created Date, Member Count, or Message Count
- **Member Management**: Editing a group or channel loads its **existing members** as selected chips — the admin sees the current membership at a glance; removing a chip removes that member on save, adding a chip adds them
- **Auto-Add New Users**: Automatically add newly registered user accounts to public chats

## Services Tab

Health cards for backend services (Media worker, Telegram connection, Storage driver):

- **Media worker**: worker reachability and queue status.
- **Telegram connection**: Telegram account connection status for remote channels with a setup feature to establish the connection.
- **Storage**: active storage driver status.

## Settings Tab

Configure runtime settings through the UI (replaces most `.env` variables):

### Categories

#### General

- Debug logging
- Sign up {Public Server}

#### File Upload

- File upload feature enabled
- Max file size per upload
- Max total size per message
- Max files per message
- Video transcoding enabled

#### Message Retention

- File retention period (days)
- Text message retention period (days)

#### Limits

- Max message length (characters)
- Max username length
- Max nickname length

#### Client Behavior

- Message fetch limits
- Message page size
- Cache TTL
- Chat list refresh interval
- Connection health check interval
- SSE reconnect delay
- Search max results
- Pending text message timeout
- Pending file message timeout
- Pending retry interval
- Pending status check interval

#### Storage (Object Storage & Worker)

- Presigned URL expiry in seconds — restart required
- Auto-configure bucket CORS — restart required
- External media worker URL (nullable, live)
- Worker fallback timeout in ms (live)

#### Realtime (restart required)

- WebSocket heartbeat interval in ms
- WebSocket heartbeat timeout in ms

#### Remote Channel

- Remote Channel feature enabled
- Allow UI toggle for channel owners
- Allow media streaming option
- Tick mode
- Polling and queue configuration

#### Proxies

- Push notification proxy URL (nullable) — restart required
- Object storage proxy URL (nullable) — restart required
- Telegram proxy URL (nullable) — restart required
- ChatDesk server-to-server proxy URL (nullable, live)

#### Calls

- Calls master toggle (live)
- Video calls toggle (live)
- Max call duration in minutes (0 = unlimited) — restart required

#### Secrets (owner-only)

- Read-only system secrets: Remote channel tick secret, Worker webhook secret, Admin API token. Visible only to the server owner, never to admins.

:::info Environment Override

[Environment variables](./Environment-Variables.md) in `.env` take precedence over database settings. Locked fields indicate an env override is active.

:::

## Logs Tab

View audit logs and system logs:

### Audit Logs

Database-backed logs of admin actions:

- User CRUD operations
- Chat CRUD operations
- Settings changes
- System actions

Each entry includes:
- Timestamp
- Actor (who performed the action)
- Action type and description
- Affected entities

### System Logs

Aggregated logs from multiple sources:
- Systemd journal (if running via systemd)
- Direct log files

## Actions Tab

Perform system administration tasks:

### Database Operations

**Backup**
- Download a timestamped engine-native database backup
- SQLite downloads a `.db` file; PostgreSQL downloads a native `.dump` archive created with `pg_dump`

**Restore**
- SQLite backups can be uploaded and restored while the service is running
- PostgreSQL restore is deliberately offline-only: stop ChatDesk, then use `npm run db:restore -- -y --file <backup.dump>`

**Vacuum**
- SQLite compacts the database file with `VACUUM`
- PostgreSQL runs native `VACUUM ANALYZE`
- Reclaims unused space and is recommended periodically for large databases

### System Control

**Version Check**
- Check current installed version
- Compare with latest GitHub release
- See if update is available

**Restart Service**
- Restart the ChatDesk server
- Applies pending changes
- Reconnects all clients

**Stop Service**
- Gracefully stop the ChatDesk server
- Requires manual start via systemd/Docker

:::warning Permission Requirements

Service control (restart/stop) requires the right setup depending on deployment:

- **Docker**: The `chatdesk` container must have the Docker socket mounted (`/var/run/docker.sock`). This is included in the default `docker-compose.yaml`. The `CHATDESK_CONTAINER_NAME` environment variable tells the app which container to target (defaults to `chatdesk`). See [Install via Docker](./Installation-Docker.md#admin-panel-service-control).
- **Systemd**: The service user must have `sudo` privileges for `systemctl`. See [Troubleshooting](./Troubleshooting.md#admin-panel-issues).

:::

### Danger Zone

**Clear All Messages**
- Delete all messages from all chats
- Preserves chat structure and membership
- Preserves user accounts
- Irreversible operation

**Reset Database**
- Clears users, chats, messages, sessions, and stored message files while preserving the schema and runtime settings
- Irreversible operation

:::danger Irreversible Actions

Danger Zone actions cannot be undone. Always create a backup before proceeding.

:::

## Disabling the Admin Panel

To completely disable the admin panel:

```bash
# In .env
ADMIN_PANEL=false
```

When disabled:
- Admin button hidden from UI
- Admin API endpoints return 403
- Existing owner and admin accounts remain but cannot access panel

## Security Notes

- Admin API uses a separate authentication token (`ADMIN_API_TOKEN`)
- Auto-generated on first run and saved to `.env` (or configured via environment variables in PaaS hosts like Render)
- Emergency admin claim endpoint (`/api/admin/claim`) verifies tokens using timing-safe comparisons and enforces HTTPS/localhost security
- Admin endpoints are localhost-only by default or restricted to authenticated admins
- All admin actions and emergency claims are logged for audit trail
- Rate limiting applies (1000 req/15min as of v0.11.1)

## CLI Alternative

Most admin operations can still be performed via CLI:

```bash
cd /opt/chatdesk/server

# User management
npm run db:user:create
npm run db:user:edit
npm run db:user:delete
npm run db:user:ban

# Chat management
npm run db:chat:create
npm run db:chat:edit
npm run db:chat:delete

# Database operations
npm run db:backup
npm run db:restore
npm run db:vacuum
npm run db:inspect
```

See [Database Commands](./Database-Commands.md) for full CLI reference.

