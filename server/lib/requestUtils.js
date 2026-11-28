export function isLoopbackRequest(req) {
  // Use the raw socket address, not req.ip. With "trust proxy" enabled,
  // req.ip is derived from the client-supplied X-Forwarded-For header,
  // which lets a remote caller spoof a loopback address. The socket's
  // remoteAddress reflects the actual TCP peer and cannot be forged.
  const source = String(req.socket?.remoteAddress || "");

  const isLoopback =
    source === "::1" || source === "127.0.0.1" || source === "::ffff:127.0.0.1";

  if (!isLoopback) return false;

  // Behind the installer's nginx (proxy_pass http://127.0.0.1:…) every
  // request arrives with a loopback socket address, so the socket check
  // alone would treat the whole internet as local. A reverse proxy that
  // forwards traffic sets X-Forwarded-For (or X-Real-IP) — if any of those
  // headers are present the TCP peer is a proxy, not the end user, and the
  // request must not be considered local. Only a genuinely direct loopback
  // connection with no forwarded headers counts.
  const forwardedHeaders = ["x-forwarded-for", "x-real-ip"];
  return !forwardedHeaders.some((name) => {
    const value = req.headers?.[name];
    return value !== undefined && String(value).trim() !== "";
  });
}

export function parseUploadFileMetadata(rawValue) {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(String(rawValue));

    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}
