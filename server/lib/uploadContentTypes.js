/**
 * Safe serving policy for uploaded message files.
 *
 * The stored mime_type is fully client-controlled (multipart mimetype, or the
 * presign payload), so it must never be trusted for Content-Type or for the
 * inline vs. attachment decision:
 *
 *   - The served Content-Type is derived from the stored filename extension
 *     via an extension allowlist. If the extension has no mapping, the stored
 *     mime is only kept when it belongs to a safe renderable family
 *     (image/video/audio, application/pdf, text/plain) — anything else (in
 *     particular any *+xml / html / javascript-ish type) is downgraded to
 *     application/octet-stream.
 *   - Inline serving requires BOTH a safe extension AND a safe stored mime:
 *     a `x.png` uploaded with `application/x-a+xml` is forced to attachment
 *     (Chromium treats *+xml as XML and would run XHTML scripts on the app
 *     origin). `X-Content-Type-Options: nosniff` is set by the serving routes.
 *   - Legitimate image/video/pdf (and audio via <audio>) inline serving the
 *     chat relies on is preserved.
 */

import path from "node:path";

// Canonical inline-safe extension set for message attachments.
export const SAFE_INLINE_MESSAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
  ".pdf",
]);

// Extension → served Content-Type. Only renderable, script-free types map.
const EXT_SERVED_MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/mp4",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".txt": "text/plain",
};

/**
 * True when the client-supplied mime must never be honored for inline
 * serving (any XML family — including generic *+xml suffixes — HTML, and
 * script types).
 */
export function isUnsafeInlineMime(mimeType) {
  const m = String(mimeType || "").toLowerCase();
  if (!m) return false;
  return m.includes("+xml") || m.includes("xml") || m.includes("html") || m.includes("javascript");
}

/**
 * True when the stored mime belongs to a renderable family safe enough to
 * echo as the served Content-Type when no extension mapping exists.
 */
export function isSafeServedContentType(mimeType) {
  const m = String(mimeType || "").toLowerCase().trim();
  if (!m) return false;
  if (isUnsafeInlineMime(m)) return false;
  if (m.startsWith("image/") || m.startsWith("video/") || m.startsWith("audio/")) {
    // image/svg+xml and friends are caught by isUnsafeInlineMime above.
    return true;
  }
  return m === "application/pdf" || m === "text/plain";
}

/**
 * Content-Type to serve for a stored upload. Derived from the stored
 * filename extension first (authoritative for the bytes on disk); falls
 * back to the stored mime only when it is in a safe renderable family;
 * otherwise application/octet-stream (with nosniff this can never execute).
 */
export function resolveServedUploadContentType(storedName, storedMime) {
  const ext = path.extname(String(storedName || "")).toLowerCase();
  if (ext && EXT_SERVED_MIME_MAP[ext]) return EXT_SERVED_MIME_MAP[ext];
  const m = String(storedMime || "").toLowerCase().trim();
  if (isSafeServedContentType(m)) return m;
  return "application/octet-stream";
}

/**
 * Inline-vs-attachment decision for a stored upload. Inline is allowed only
 * when the extension is on the safe list AND the client mime carries no XML/
 * HTML/script payload AND the resolved served type is renderable.
 */
export function shouldServeInline(storedName, storedMime) {
  const ext = path.extname(String(storedName || "")).toLowerCase();
  if (!SAFE_INLINE_MESSAGE_EXTENSIONS.has(ext)) return false;
  if (isUnsafeInlineMime(storedMime)) return false;
  const served = resolveServedUploadContentType(storedName, storedMime);
  return served !== "application/octet-stream";
}
