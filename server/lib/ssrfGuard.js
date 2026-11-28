/**
 * SSRF guard for server-side outbound fetches (Remote Channel federation,
 * remote metadata/avatar sync).
 *
 * The guard layers four defenses, applied to the target URL AND to every
 * redirect hop (redirects are never followed implicitly — fetch() runs with
 * redirect:"manual" and the loop below re-validates each hop):
 *
 *   1. Literal host check  — isPrivateHost() rejects loopback / RFC-1918 /
 *      link-local / CGNAT / 0.0.0.0 / ULA / IPv4-mapped and bracketed IPv6
 *      literals ([::1], [fd00::1], [::ffff:127.0.0.1], …).
 *   2. DNS resolution check — assertPublicDnsResolution() resolves the
 *      hostname locally (node:dns — no new dependency) and rejects any
 *      resolved address that isPrivateHost() flags. This catches "localhost",
 *      *.internal names and rebinding-style hostnames that pass a literal
 *      string check. Skipped when a proxy dispatcher is configured, because
 *      in that case the DNS resolution happens on the proxy host.
 *   3. Redirect control — fetch runs with redirect:"manual"; 3xx responses
 *      are resolved and re-validated hop by hop with a hard hop cap.
 *   4. Body size caps — readBodyWithCap() streams the response and aborts
 *      once the byte cap is exceeded (unbounded bodies = memory DoS).
 *
 * A static allowlist is intentionally not used — the Remote Channel feature
 * federates with any public ChatDesk server, so the hostname is open-ended by
 * design.
 * codeql[js/ssrf] - target and every redirect hop validated against the
 *                   private-address blocklist + resolved-IP check.
 */

import net from "node:net";
import dnsPromises from "node:dns/promises";

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const DEFAULT_MAX_REDIRECTS = 5;
// Cap for remote avatar downloads (body is saved to the local upload root and
// re-served publicly — an unbounded body would be a memory/disk DoS).
export const MAX_REMOTE_AVATAR_DOWNLOAD_BYTES = 10 * 1024 * 1024;

const blocked = (reason) =>
  new Error(`Request blocked: ${reason}`);

export function stripIpv6Brackets(hostname) {
  const h = String(hostname || "").toLowerCase().trim();
  if (h.startsWith("[") && h.endsWith("]")) return h.slice(1, -1);
  return h;
}

/** Validates a dotted-quad IPv4 string; returns true if private/reserved. */
export function isPrivateIpv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || "").trim());
  if (!m) return false;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((v) => v > 255)) return false;
  // 0.0.0.0/8 ("this network", includes 0.0.0.0)
  if (o[0] === 0) return true;
  // 10.0.0.0/8
  if (o[0] === 10) return true;
  // 100.64.0.0/10 (CGNAT)
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
  // 127.0.0.0/8 (loopback)
  if (o[0] === 127) return true;
  // 169.254.0.0/16 (link-local incl. cloud metadata endpoints)
  if (o[0] === 169 && o[1] === 254) return true;
  // 172.16.0.0/12
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  // 192.168.0.0/16
  if (o[0] === 192 && o[1] === 168) return true;
  // 255.255.255.255 (broadcast)
  if (o[0] === 255 && o[1] === 255 && o[2] === 255 && o[3] === 255) return true;
  return false;
}

function isPrivateIpv4FromWords(hi, lo) {
  const ip = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  return isPrivateIpv4(ip);
}

/**
 * Expands an IPv6 address into 8 numeric 16-bit groups.
 * Handles "::" compression, dotted-quad tails ("::ffff:127.0.0.1") and
 * zone suffixes ("fe80::1%eth0"). Returns null for malformed input.
 */
export function expandIpv6(address) {
  let addr = String(address || "").toLowerCase().trim();
  if (!addr || !/^[0-9a-f:.]+(%[0-9a-z_.~-]+)?$/i.test(addr)) return null;
  if (addr.includes("%")) addr = addr.split("%")[0];
  if (!addr.includes(":")) return null;

  const doubleColons = (addr.match(/::/g) || []).length;
  if (doubleColons > 1) return null;

  let head = addr;
  let tail = "";
  if (doubleColons === 1) {
    const idx = addr.indexOf("::");
    head = addr.slice(0, idx);
    tail = addr.slice(idx + 2);
  }

  const groups = [];
  for (const part of [...(head === "" ? [] : head.split(":")), ...(tail === "" ? [] : tail.split(":"))]) {
    if (part.includes(".")) {
      const octets = part.split(".").map(Number);
      if (octets.length !== 4 || octets.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
      groups.push(((octets[0] << 8) | octets[1]) >>> 0);
      groups.push(((octets[2] << 8) | octets[3]) >>> 0);
    } else {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(parseInt(part, 16));
    }
  }

  const fill = 8 - groups.length;
  if (doubleColons === 1) {
    if (fill < 0) return null;
    groups.splice(head === "" ? 0 : groups.length - (tail === "" ? 0 : tail.split(":").length), 0, ...new Array(fill).fill(0));
  } else if (fill !== 0) {
    return null;
  }
  return groups;
}

/** Validates an IPv6 address string (brackets-free); true if private/reserved. */
export function isPrivateIpv6(address) {
  const g = expandIpv6(address);
  // Fail closed on malformed addresses.
  if (!g) return true;

  const allZero = g.every((v) => v === 0);
  // :: (unspecified)
  if (allZero) return true;
  // ::1 (loopback)
  if (g.slice(0, 7).every((v) => v === 0) && g[7] === 1) return true;
  // ::ffff:0:0/96 (IPv4-mapped, e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (g.slice(0, 5).every((v) => v === 0) && g[5] === 0xffff) {
    return isPrivateIpv4FromWords(g[6], g[7]);
  }
  // IPv4-compatible (deprecated ::a.b.c.d form)
  if (g.slice(0, 6).every((v) => v === 0) && (g[6] !== 0 || g[7] !== 0)) {
    return isPrivateIpv4FromWords(g[6], g[7]);
  }
  // 64:ff9b::/96 (well-known NAT64 prefix — embeds an IPv4 address)
  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((v) => v === 0)) {
    return isPrivateIpv4FromWords(g[6], g[7]);
  }
  // 2002::/16 (6to4 — embeds an IPv4 address in groups 1-2)
  if (g[0] === 0x2002) {
    return isPrivateIpv4FromWords(g[1], g[2]);
  }
  // fe80::/10 (link-local)
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  // fec0::/10 (deprecated site-local)
  if ((g[0] & 0xffc0) === 0xfec0) return true;
  // fc00::/7 (unique local addresses: fc00::–fdff::)
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  return false;
}

/**
 * Returns true if the hostname is a private/loopback/link-local address that
 * should never be the target of a server-side outbound request.
 * Blocks SSRF against internal services and cloud metadata endpoints.
 *
 * Handles bracketed IPv6 literals ([::1]), IPv4-mapped IPv6
 * ([::ffff:127.0.0.1] / [::ffff:7f00:1]), CGNAT (100.64.0.0/10) and 0.0.0.0/8
 * in addition to the classic RFC-1918/link-local string checks.
 */
export function isPrivateHost(hostname) {
  const raw = String(hostname || "").toLowerCase().trim();
  if (!raw) return true; // fail closed on empty host

  const h = stripIpv6Brackets(raw);

  // IPv6 literal (bracketed, or any host containing ":" — WHATWG URL keeps
  // the brackets on .hostname, so raw !== h means a bracketed literal).
  if (raw !== h || h.includes(":")) {
    return isPrivateIpv6(h);
  }

  if (h === "localhost" || h === "metadata.google.internal") return true;

  // Dotted-quad IPv4 → full range checks (0/8, 10/8, 100.64/10, 127/8,
  // 169.254/16, 172.16/12, 192.168/16, 255.255.255.255).
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(h)) {
    return isPrivateIpv4(h);
  }

  // Partial IPv4 forms (e.g. "127.1" as a string) — keep the legacy
  // prefix checks as a safety net.
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^0\./.test(h)) return true;

  // IPv4-mapped IPv6 in unbracketed string form (defensive; WHATWG URL
  // normalizes to the bracketed form).
  if (/^::ffff:(\d{1,3}\.){3}\d{1,3}$/i.test(h)) return isPrivateIpv4(h.slice(7));
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(h)) return isPrivateIpv6(h);

  return false;
}

/**
 * Resolves `hostname` via node:dns and rejects if ANY resolved address is
 * private/reserved. IP literals short-circuit (already validated by
 * isPrivateHost). Throws a "Request blocked" error on private resolution,
 * empty resolution or DNS failure — the subsequent fetch would fail anyway.
 */
export async function assertPublicDnsResolution(hostname) {
  const host = stripIpv6Brackets(hostname);
  if (net.isIP(host)) return; // literal — already covered by isPrivateHost
  let records;
  try {
    records = await dnsPromises.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    throw blocked(`DNS resolution failed for '${host}' (${String(err?.code || err?.message || err)}).`);
  }
  if (!records || !records.length) {
    throw blocked(`'${host}' did not resolve to any address.`);
  }
  for (const record of records) {
    if (isPrivateHost(record.address)) {
      throw blocked(`'${host}' resolves to a private or internal address (${record.address}).`);
    }
  }
}

/**
 * Hardened fetch: validates the target URL and every redirect hop against
 * the private-address blocklist, performs the DNS resolution check (unless
 * config.skipDnsCheck), and fetches with redirect:"manual" so redirects are
 * never followed implicitly.
 */
export async function ssrfFetch(url, options = {}, config = {}) {
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  const maxRedirects = Number.isFinite(config.maxRedirects)
    ? config.maxRedirects
    : DEFAULT_MAX_REDIRECTS;
  const skipDnsCheck = Boolean(config.skipDnsCheck);

  let currentUrl = String(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch (_) {
      throw blocked("URL is invalid.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw blocked(`URL protocol '${parsed.protocol}' is not allowed.`);
    }
    if (isPrivateHost(parsed.hostname)) {
      throw blocked(`'${parsed.hostname}' is a private or internal address.`);
    }
    if (!skipDnsCheck) {
      await assertPublicDnsResolution(parsed.hostname);
    }

    const response = await fetchImpl(currentUrl, { ...options, redirect: "manual" });
    if (!response || !REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    // Drain the redirect body so the socket can be reused, then hop.
    try {
      await response.arrayBuffer();
    } catch (_) {}
    const location = response.headers?.get?.("location");
    if (!location) return response;
    try {
      currentUrl = new URL(location, currentUrl).href;
    } catch (_) {
      throw blocked("redirect target is invalid.");
    }
  }
  throw blocked(`too many redirects (>${maxRedirects}).`);
}

/**
 * Streams a response body and returns a Buffer, or null when the body
 * exceeds maxBytes (the connection is cancelled in that case).
 */
export async function readBodyWithCap(response, maxBytes) {
  const body = response?.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.byteLength || 0;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch (_) {}
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    } catch (_) {
      return null;
    }
    return Buffer.concat(chunks);
  }
  try {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  } catch (_) {
    return null;
  }
}
