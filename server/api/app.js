import { readAppMeta } from "../lib/appMeta.js";

function registerAppRoutes(app, deps) {
  const {
    REMOTE_CHANNELS,
    getSetting,
    fs,
    path,
    projectRootDir,
    getSessionFromRequest,
    isUserOwner,
  } = deps;

  app.get("/api/app/info", (_req, res) => {
    const appMeta = readAppMeta({ fs, path, projectRootDir });
    res.json({
      version: appMeta.version,
      normalizedVersion: appMeta.normalizedVersion,
      channel: appMeta.channel,
      // NOTE: changelog fields are intentionally NOT exposed here — the
      // "What's new" payload is a privilege of the system owner and is
      // served exclusively by GET /api/app/whats-new (owner-only).
      repository: appMeta.repository,
      // Live runtime config the client needs before it can render auth/chat
      // UI correctly. Read via getSetting() on every request so admin-panel
      // changes take effect immediately, without a client rebuild or reload
      // being required beyond a normal page fetch.
      accountCreationEnabled: Boolean(getSetting("SIGN_UP")),
      adminPanelEnabled: !["0", "false", "no", "n", "off"].includes(
        String(process.env.ADMIN_PANEL ?? "true").trim().toLowerCase(),
      ),
      messageMaxChars: Number(getSetting("MESSAGE_MAX_CHARS")) || 4000,
      usernameMaxChars: Number(getSetting("USERNAME_MAX_CHARS")) || 16,
      nicknameMaxChars: Number(getSetting("NICKNAME_MAX_CHARS")) || 24,
      fileUploadEnabled: Boolean(getSetting("FILE_UPLOAD")),
      fileUploadMaxFiles: Number(getSetting("FILE_UPLOAD_MAX_FILES")) || 10,
      fileUploadMaxSizeMb: Number(getSetting("FILE_UPLOAD_MAX_SIZE_MB")) || 25,
      fileUploadMaxTotalSizeMb: Number(getSetting("FILE_UPLOAD_MAX_TOTAL_SIZE_MB")) || 75,
      chatMessageFetchLimit: Number(getSetting("CHAT_MESSAGE_FETCH_LIMIT")) || 60,
      chatMessagePageSize: Number(getSetting("CHAT_MESSAGE_PAGE_SIZE")) || 60,
      chatCacheTtlHours: Number(getSetting("CHAT_CACHE_TTL")) || 24,
      chatListRefreshIntervalMs: Number(getSetting("CHAT_LIST_REFRESH_INTERVAL")) || 20000,
      chatHealthCheckIntervalMs: Number(getSetting("CHAT_HEALTH_CHECK_INTERVAL")) || 10000,
      chatSseReconnectDelayMs: Number(getSetting("CHAT_SSE_RECONNECT_DELAY")) || 2000,
      chatSearchMaxResults: Number(getSetting("CHAT_SEARCH_MAX_RESULTS")) || 5,
      chatPendingTextTimeoutMs: Number(getSetting("CHAT_PENDING_TEXT_TIMEOUT")) || 300000,
      chatPendingFileTimeoutMs: Number(getSetting("CHAT_PENDING_FILE_TIMEOUT")) || 1200000,
      chatPendingRetryIntervalMs: Number(getSetting("CHAT_PENDING_RETRY_INTERVAL")) || 4000,
      chatPendingStatusCheckIntervalMs: Number(getSetting("CHAT_PENDING_STATUS_CHECK_INTERVAL")) || 1000,
      callsEnabled: Boolean(getSetting("CALL")),
      videoCallsEnabled: Boolean(getSetting("CALL_VIDEO")),
      remoteChannels: {
        // enabled/telegramConfigured/proxyConfigured stay restart-scoped
        // (Telegram credentials + remoteChannelManager are wired once at
        // startup), but uiEnabled/mediaStreamEnabled are pure display flags
        // read live so toggling them in the admin panel applies immediately.
        enabled: Boolean(REMOTE_CHANNELS?.enabled),
        uiEnabled: Boolean(getSetting("REMOTE_CHANNEL_UI")),
        mediaStreamEnabled: Boolean(getSetting("REMOTE_CHANNEL_MEDIA_STREAM")),
        telegramConfigured: Boolean(REMOTE_CHANNELS?.telegramConfigured),
        chatdeskConfigured: Boolean(REMOTE_CHANNELS?.enabled),
        proxyConfigured: Boolean(REMOTE_CHANNELS?.proxyConfigured),
      },
    });
  });

  // ─── What's new (OWNER-ONLY) ────────────────────────────────────────────────
  //
  // The per-version "what's new" payload (changelog popup + the "What's new"
  // settings entry) is a privilege of the system owner alone. The server is
  // the authority: non-owner sessions (admins, operators, users, anonymous)
  // get 403/401 and the client never shows the popup or the settings entry
  // for them.
  app.get("/api/app/whats-new", async (req, res) => {
    const rawSession = getSessionFromRequest ? getSessionFromRequest(req) : null;
    const session =
      rawSession && typeof rawSession.then === "function"
        ? await rawSession
        : rawSession;
    if (!session || !session.id) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    const rawIsOwner = typeof isUserOwner === "function" ? isUserOwner(session.id) : false;
    const isOwner =
      rawIsOwner && typeof rawIsOwner.then === "function" ? await rawIsOwner : rawIsOwner;
    if (!isOwner) {
      return res.status(403).json({ error: "Owner access required.", code: "owner_only" });
    }
    const appMeta = readAppMeta({ fs, path, projectRootDir });
    res.json({
      version: appMeta.version,
      normalizedVersion: appMeta.normalizedVersion,
      channel: appMeta.channel,
      changelog: appMeta.changelog,
      changelogSections: appMeta.changelogSections,
      currentChangelog: appMeta.currentChangelog,
    });
  });
}

export { registerAppRoutes };
