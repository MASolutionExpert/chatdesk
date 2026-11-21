[English](/README.md) | [فارسی](/README.fa_IR.md)

<div align="center">

# <img src="./client/public/chatdesk-logo.svg" alt="ChatDesk"> ChatDesk

![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)

**Self-hosted support messenger — a messenger feel with a ticketing engine behind it**

</div>

## What is ChatDesk?

ChatDesk is a secure, lightweight, self-hosted chat platform built for customer
support teams. Your customers sign up, pick the department they need, and land
in a real conversation — while your operators get a fair-routed, enterprise
helpdesk behind the scenes.

## Key Features

- 🎧 **Helpdesk Mode**: Departments, operator roles, and fair routing (round-robin / least-busy) for incoming support requests
- 💬 **Messenger Feel**: Direct messages, groups, and channels with a real-time chat experience
- 🗂️ **Ticketing Engine**: Request status, assignment, tags, and internal notes that stay hidden from customers
- 📁 **Media Support**: File uploads, voice messages, video transcoding
- 🔔 **Push Notifications**: Web push with VAPID
- 📞 **Voice & Video Calls**: Real-time peer-to-peer calling
- 📡 **Remote Channels**: Mirror Telegram or ChatDesk channels
- 🛡️ **Admin Panel**: Full management interface with owner role, operator accounts, and department management
- 📊 **Reports**: Conversation volume, response times, and operator activity
- 🔒 **Security**: Encryption at rest, bcrypt hashing, rate limiting
- 📱 **PWA**: Installable progressive web app
- ☁️ **Cloud Deployment**: PaaS and CaaS deployment with object storage support
- 🌍 **i18n**: English and Persian/Farsi support

## Quick Start

The easiest way to install ChatDesk is the deployment script. On an Ubuntu
server (22.04+) with sudo access, run:

```bash
curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/chatdesk/main/scripts/install.sh | bash
```

The script handles dependencies, builds the app, configures Nginx, and can set
up SSL for you. After installation, access it again anytime with:

```bash
chatdesk-deploy
```

> [!TIP]
> A domain name pointing to your server's public IP is recommended, and HTTPS
> is required for push notifications (except on `localhost`).

### Release channels (Test vs Stable)

ChatDesk runs a two-channel DevOps pipeline — test installs and production
installs never mix:

| Channel | Branch | Versions | Install command |
|---------|--------|----------|-----------------|
| **Stable** (production) | `main` | `vX.Y.Z` | `curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/chatdesk/main/scripts/install.sh \| bash` |
| **Test** (pre-release) | `dev` | `vX.Y.Z-dev.N` | `curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/chatdesk/dev/scripts/install.sh \| REPO_BRANCH=dev bash` |

- The installer remembers the channel it came from; `chatdesk-deploy` →
  **Update** always stays inside that channel (a Stable install never receives
  a `-dev` prerelease, and vice versa). The in-app update check follows the
  same rule.
- Check what a server is running anytime: `chatdesk-deploy --status` prints
  the installer version, installed version and channel. The menu banner shows
  the same information.
- To move an existing install to the other channel, run `chatdesk-deploy` →
  **Switch Test (dev) / Stable channel**. It backs up, switches branches and
  runs the full update pipeline (dependencies, migrations, client build,
  service restart, health check).
- A dev build reaches the Stable channel **only** through the
  **"Promote dev to Stable"** GitHub Actions workflow: after you test and
  approve a dev version, run the workflow from the Actions tab with its tag
  (e.g. `v1.1.0-dev.6`). It merges the tag into `main`, rewrites
  VERSION/installer/CHANGELOG to the stable form, tags `vX.Y.Z` on `main` and
  publishes the stable release. Nothing else ever writes to `main`.

## Documentation

Full documentation lives in the [docs](/docs) folder:

- [Deployment Script](/docs/Deployment-Script.md)
- [Helpdesk Setup](/docs/Helpdesk-Setup.md)
- [Install via Docker](/docs/Installation-Docker.md)
- [Cloud Deployment](/docs/Cloud-Deployment.md)
- [Manual Installation](/docs/Manual-Installation.md)
- [Configure Nginx](/docs/Nginx-Configuration.md)
- [SSL Certificates](/docs/SSL-Certificates.md)
- [Running behind a CDN](/docs/CDN-Setup.md)
- [Running behind a domain + subpath](/docs/Subpath-Hosting.md)
- [Environment Variables](/docs/Environment-Variables.md)
- [Object Storage](/docs/Object-Storage.md)
- [Media Worker](/docs/Media-Worker.md)
- [Admin Panel](/docs/Admin-Panel.md)
- [Remote Channel Setup](/docs/Remote-Channel-Setup.md)
- [Push Notification Proxy](/docs/Push-Notification-Proxy.md)
- [Voice & Video Calls](/docs/Voice-Video-Calls.md)
- [Updating the deployed app](/docs/Updating.md)
- [Database Commands](/docs/Database-Commands.md)
- [Troubleshooting](/docs/Troubleshooting.md)

Persian documentation is available under [docs/fa](/docs/fa).

## Project Structure

| Path      | Description                                        |
| --------- | -------------------------------------------------- |
| `client/` | React 19 + Vite frontend (PWA)                     |
| `server/` | Express 5 API with SSE realtime (Knex ORM)         |
| `worker/` | Media transcoding worker (ffmpeg)                  |
| `docs/`   | English and Persian documentation                  |

## Contributing

Contributions are welcome. Please read the [contributing guide](/CONTRIBUTING.md)
and open an issue at `https://github.com/MASolutionExpert/chatdesk/issues`
before starting work on a large change.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE)
file for details.
