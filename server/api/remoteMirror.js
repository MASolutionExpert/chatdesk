import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  resolveServedUploadContentType,
  shouldServeInline,
} from "../lib/uploadContentTypes.js";

/**
 * remoteMirror.js — server side of the Option A media handoff.
 *
 * - GET /api/remote-channel/blob/:jobId — secret-gated byte pull for the
 *   worker. No session auth (workers have none); the per-job secret is the
 *   credential (256-bit, single job, TTL-bound).
 * - POST /api/remote-channel/webhook/mirror-done — worker result callback
 *   gated by the shared webhook secret. Attaches the finished file via the
 *   manager so message rows, transcode, and SSE stay in one place.
 */

function registerRemoteMirrorRoutes(app, deps) {
  const { mirrorJobRegistry, remoteChannelManager, webhookSecret, fs, crypto } =
    deps;

  const expectedWebhookSecret =
    webhookSecret !== undefined
      ? webhookSecret
      : process.env.WEBHOOK_SECRET || "";

  const blobLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (_req, res) =>
      res.status(429).json({ error: "Too many requests." }),
  });

  // ─── Byte pull for the worker ─────────────────────────────────────────────
  app.get("/api/remote-channel/blob/:jobId", blobLimiter, async (req, res) => {
    const entry = mirrorJobRegistry?.get?.(req.params?.jobId);
    if (!entry || entry.settled)
      return res.status(404).json({ error: "Not found." });
    const provided = String(req.headers["x-chatdesk-mirror-secret"] || "");
    const expected = String(entry.secret || "");
    if (!expected || !provided)
      return res.status(401).json({ error: "Unauthorized." });
    let match = false;
    try {
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      match = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      match = false;
    }
    if (!match) return res.status(401).json({ error: "Unauthorized." });

    let bytes = null;
    try {
      bytes = fs.readFileSync(entry.filePath);
    } catch {
      return res.status(404).json({ error: "Not found." });
    }
    // Same safe-serving policy as the message upload routes
    // (server/api/uploadsRemote.js): entry.mimeType is client-controlled
    // metadata — never echo it verbatim. The served Content-Type is derived
    // from the stored filename/reference, and anything outside the safe
    // inline policy (XML/HTML/script-ish types) is forced to attachment so
    // mirrored bytes can never execute on the app origin. Safe
    // image/video/audio/pdf inline serving is preserved.
    const storedRef = entry.storedName || entry.originalName || "";
    const storedMime = entry.mimeType || "";
    res.setHeader(
      "Content-Type",
      resolveServedUploadContentType(storedRef, storedMime),
    );
    if (!shouldServeInline(storedRef, storedMime)) {
      res.setHeader("Content-Disposition", "attachment");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(bytes.length));
    return res.send(bytes);
  });

  // ─── Worker result callback ───────────────────────────────────────────────
  app.post("/api/remote-channel/webhook/mirror-done", async (req, res) => {
    if (expectedWebhookSecret) {
      const headerSecret = req.headers["x-chatdesk-webhook-secret"];
      if (headerSecret !== expectedWebhookSecret) {
        return res.status(401).json({ error: "Unauthorized webhook request." });
      }
    }
    const {
      jobId,
      status,
      storageKey,
      storageDriver,
      sizeBytes,
      widthPx,
      heightPx,
      durationSeconds,
      mimeType,
      error,
    } = req.body || {};
    // Settle exactly once — the local-fallback timer loses if we win.
    const entry = mirrorJobRegistry?.settle?.(jobId, "webhook");
    if (!entry) return res.json({ ok: true, deduped: true });
    // Temp bytes are no longer needed: the bucket holds the finished copy.
    try {
      mirrorJobRegistry?.unlinkQuiet?.(entry.filePath);
    } catch {
      // Best effort.
    }
    if (status !== "ready" || !storageKey) {
      console.warn(
        "[remote-mirror] Job %s failed: %s",
        String(jobId),
        String(error || "no storage key"),
      );
      return res.json({ ok: true, attached: false });
    }
    // A retried queue item may dispatch the same file twice while a previous
    // delivery is still in flight — skip when the file is already attached.
    try {
      const alreadyAttached =
        await remoteChannelManager?.hasMirroredFile?.(
          entry.messageId,
          entry.originalName || entry.storedName || "file",
        );
      if (alreadyAttached) return res.json({ ok: true, attached: false, deduped: true });
    } catch {
      // Best effort — fall through to the attach attempt.
    }
    try {
      await remoteChannelManager?.attachMirroredMedia?.({
        messageId: entry.messageId,
        chatId: entry.chatId,
        authorId: entry.authorId,
        authorUsername: entry.authorUsername,
        file: {
          kind: entry.kind || "document",
          originalName: entry.originalName || entry.storedName || "file",
          storedName: entry.storedName,
          mimeType: mimeType || entry.mimeType || "application/octet-stream",
          sizeBytes: Number(sizeBytes || entry.actualSize || 0) || 0,
          widthPx: widthPx ?? entry.widthPx ?? null,
          heightPx: heightPx ?? entry.heightPx ?? null,
          durationSeconds: durationSeconds ?? entry.durationSeconds ?? null,
          expiresAt: null,
          storageDriver: storageDriver || "remote",
          storage_driver: storageDriver || "remote",
          storageKey,
          storage_key: storageKey,
          encryptionType: "none",
          encryption_type: "none",
        },
      });
      return res.json({ ok: true, attached: true });
    } catch (attachError) {
      console.warn(
        "[remote-mirror] Attach failed for job %s: %s",
        String(jobId),
        String(attachError?.message || attachError),
      );
      return res.json({ ok: true, attached: false });
    }
  });
}

export { registerRemoteMirrorRoutes };
