/**
 * Tests for the SSRF guard (server/lib/ssrfGuard.js) backing chatdeskFetch()
 * in remoteChannels.js — Stage 2 HIGH fix for the Remote Channel SSRF
 * bypasses:
 *   - bracketed IPv6 literals ([::1], [fd00::1], [::ffff:7f00:1]) passed the
 *     old plain string hostname check;
 *   - fetch followed redirects by default, without re-validating hops;
 *   - no DNS-resolution check existed (localhost / rebinding hosts);
 *   - response bodies (avatars) were unbounded.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:dns/promises", () => {
  return {
    default: {
      lookup: vi.fn(async (host) => {
        // Simulate: anything under *.rebind resolves to a private address,
        // everything else resolves to a public address.
        if (String(host).endsWith(".rebind.example")) {
          return [
            { address: "169.254.169.254", family: 4 },
          ];
        }
        return [{ address: "93.184.216.34", family: 4 }];
      }),
    },
  };
});

import {
  isPrivateHost,
  isPrivateIpv4,
  isPrivateIpv6,
  assertPublicDnsResolution,
  ssrfFetch,
  readBodyWithCap,
  DEFAULT_MAX_REDIRECTS,
  MAX_REMOTE_AVATAR_DOWNLOAD_BYTES,
} from "../../lib/ssrfGuard.js";

const PUBLIC_URL = "https://93.184.216.34/resource";

// ─── isPrivateHost — IPv6 literals and IPv4 ranges ───────────────────────────

describe("isPrivateHost (hardened)", () => {
  test.each([
    // Bracketed IPv6 literals kept their brackets before the fix.
    "[::1]",
    "[fd00::1]",
    "[::ffff:7f00:1]",
    "[::ffff:127.0.0.1]",
    "[fe80::1]",
    "[fc00::1]",
    "[::]",
    "[::ffff:0.0.0.0]",
    // Bare IPv6
    "::1",
    "::",
    "fd12::5",
    "fe80::a",
    "::ffff:169.254.169.254",
    // NAT64 well-known prefix embedding a loopback IPv4
    "64:ff9b::7f00:1",
    // 6to4 embedding a private IPv4
    "2002:ac10:fe::",
    // IPv4
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "172.31.255.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "0.1.2.3",
    "255.255.255.255",
    "localhost",
    "metadata.google.internal",
  ])("blocks %s", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  test.each([
    "example.com",
    "example.com.",
    "8.8.8.8",
    "100.128.0.1", // just outside CGNAT (100.64.0.0/10)
    "172.32.0.1", // just outside 172.16/12
    "169.255.1.1", // just outside link-local
    "2001:4860:4860::8888",
    "[2606:4700::6810:85e5]",
    "chatdesk.example.org",
  ])("allows %s", (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });

  test("fails closed on empty host", () => {
    expect(isPrivateHost("")).toBe(true);
    expect(isPrivateHost(null)).toBe(true);
  });

  test("isPrivateIpv4 / isPrivateIpv6 helpers classify correctly", () => {
    expect(isPrivateIpv4("10.0.0.1")).toBe(true);
    expect(isPrivateIpv4("11.0.0.1")).toBe(false);
    expect(isPrivateIpv4("999.1.1.1")).toBe(false);
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("2606:4700::6810")).toBe(false);
    // Malformed input fails closed.
    expect(isPrivateIpv6("not-an-ip::zz")).toBe(true);
  });
});

// ─── DNS resolution check ─────────────────────────────────────────────────────

describe("assertPublicDnsResolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects a hostname that resolves to a private address", async () => {
    await expect(
      assertPublicDnsResolution("aws.rebind.example"),
    ).rejects.toThrow(/private or internal address/);
  });

  test("accepts a hostname with only public resolutions", async () => {
    await expect(
      assertPublicDnsResolution("chatdesk.example.org"),
    ).resolves.toBeUndefined();
  });

  test("skips IP literals (already covered by isPrivateHost)", async () => {
    const dns = (await import("node:dns/promises")).default;
    await expect(assertPublicDnsResolution("93.184.216.34")).resolves.toBeUndefined();
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});

// ─── ssrfFetch — redirect handling + per-hop validation ──────────────────────

describe("ssrfFetch", () => {
  const fetchJson = (status, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  test("rejects a private target before any network call", async () => {
    const fetchImpl = vi.fn();
    await expect(
      ssrfFetch("http://[::1]:8080/admin", {}, { fetchImpl, skipDnsCheck: true }),
    ).rejects.toThrow(/private or internal address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects a redirect hop to a private address (169.254.169.254)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        fetchJson(302, { location: "http://169.254.169.254/latest/meta-data/" }),
      );
    await expect(
      ssrfFetch(PUBLIC_URL, {}, { fetchImpl, skipDnsCheck: true }),
    ).rejects.toThrow(/private or internal address/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects a redirect hop to a bracketed IPv6 literal", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fetchJson(302, { location: "http://[fd00::1]/x" }));
    await expect(
      ssrfFetch(PUBLIC_URL, {}, { fetchImpl, skipDnsCheck: true }),
    ).rejects.toThrow(/private or internal address/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("fetches with redirect: manual so undici never auto-follows", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJson(200));
    await ssrfFetch(PUBLIC_URL, {}, { fetchImpl, skipDnsCheck: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      PUBLIC_URL,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  test("follows a public redirect chain and re-validates each hop", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        fetchJson(301, { location: "https://93.184.216.34/redirected" }),
      )
      .mockResolvedValueOnce(fetchJson(200));
    const res = await ssrfFetch(PUBLIC_URL, {}, { fetchImpl, skipDnsCheck: true });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe("https://93.184.216.34/redirected");
  });

  test("caps the redirect chain", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () =>
      fetchJson(302, { location: `${PUBLIC_URL}?next` }),
    );
    await expect(
      ssrfFetch(PUBLIC_URL, {}, { fetchImpl, skipDnsCheck: true }),
    ).rejects.toThrow(/too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(DEFAULT_MAX_REDIRECTS + 1);
  });

  test("rejects non-http(s) protocols", async () => {
    const fetchImpl = vi.fn();
    await expect(
      ssrfFetch("file:///etc/passwd", {}, { fetchImpl, skipDnsCheck: true }),
    ).rejects.toThrow(/protocol/);
    await expect(
      ssrfFetch("gopher://example.com", {}, { fetchImpl, skipDnsCheck: true }),
    ).rejects.toThrow(/protocol/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("runs the DNS check per hop unless skipped", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJson(200));
    // .rebind.example resolves to 169.254.169.254 in the dns mock → blocked.
    await expect(
      ssrfFetch(
        "https://aws.rebind.example/x",
        {},
        { fetchImpl },
      ),
    ).rejects.toThrow(/private or internal address/);
    expect(fetchImpl).not.toHaveBeenCalled();
    // Public literal target with skipDnsCheck bypasses the resolver entirely.
    await expect(
      ssrfFetch(PUBLIC_URL, {}, { fetchImpl, skipDnsCheck: true }),
    ).resolves.toBeDefined();
  });
});

// ─── readBodyWithCap ──────────────────────────────────────────────────────────

describe("readBodyWithCap", () => {
  const bodyResponse = (bytes) => ({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
  });

  test("returns the buffer when the body fits the cap", async () => {
    const buf = await readBodyWithCap(bodyResponse([1, 2, 3]), 10);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(3);
  });

  test("returns null (and cancels) when the body exceeds the cap", async () => {
    const buf = await readBodyWithCap(bodyResponse(new Array(64).fill(1)), 10);
    expect(buf).toBeNull();
  });

  test("avatar download cap is bounded", () => {
    expect(MAX_REMOTE_AVATAR_DOWNLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  test("falls back to arrayBuffer when no stream body exists", async () => {
    const res = { arrayBuffer: async () => new Uint8Array([9, 9]).buffer };
    const buf = await readBodyWithCap(res, 10);
    expect(buf.length).toBe(2);
    const over = await readBodyWithCap(res, 1);
    expect(over).toBeNull();
  });
});
