import { describe, test, expect } from "vitest";
import {
  isLoopbackRequest,
  parseUploadFileMetadata,
} from "../../lib/requestUtils.js";

// Minimal request stub — only the socket.remoteAddress field matters.
const makeReq = (remoteAddress) => ({ socket: { remoteAddress } });

describe("isLoopbackRequest", () => {
  test("returns true for IPv6 loopback ::1", () => {
    expect(isLoopbackRequest(makeReq("::1"))).toBe(true);
  });

  test("returns true for IPv4 loopback 127.0.0.1", () => {
    expect(isLoopbackRequest(makeReq("127.0.0.1"))).toBe(true);
  });

  test("returns true for IPv4-mapped loopback ::ffff:127.0.0.1", () => {
    expect(isLoopbackRequest(makeReq("::ffff:127.0.0.1"))).toBe(true);
  });

  test("returns false for a regular IPv4 address", () => {
    expect(isLoopbackRequest(makeReq("192.168.1.100"))).toBe(false);
  });

  test("returns false for a public IPv6 address", () => {
    expect(isLoopbackRequest(makeReq("2001:db8::1"))).toBe(false);
  });

  test("returns false when remoteAddress is undefined", () => {
    expect(isLoopbackRequest({ socket: {} })).toBe(false);
  });

  test("returns false when socket is missing", () => {
    expect(isLoopbackRequest({})).toBe(false);
  });

  test("returns false for a spoofed loopback in a forwarded header (socket address used, not req.ip)", () => {
    const req = { socket: { remoteAddress: "203.0.113.5" }, ip: "127.0.0.1" };
    expect(isLoopbackRequest(req)).toBe(false);
  });

  // ─── F3: loopback behind a reverse proxy ────────────────────────────────────
  // The installer's nginx proxies to http://127.0.0.1:…, so EVERY internet
  // request arrives with a loopback socket address. A reverse proxy that
  // forwards traffic sets X-Forwarded-For / X-Real-IP — such a request must
  // NOT count as local (otherwise /api/admin/db-tools with delete_db/reset_db
  // would be internet-reachable with just the token).

  test("returns false for loopback socket WITH X-Forwarded-For (behind nginx)", () => {
    const req = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "203.0.113.7" },
    };
    expect(isLoopbackRequest(req)).toBe(false);
  });

  test("returns false for loopback socket WITH X-Real-IP", () => {
    const req = {
      socket: { remoteAddress: "::1" },
      headers: { "x-real-ip": "203.0.113.7" },
    };
    expect(isLoopbackRequest(req)).toBe(false);
  });

  test("returns false even when the forwarded header value is a loopback IP (spoof attempt)", () => {
    const req = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "127.0.0.1" },
    };
    expect(isLoopbackRequest(req)).toBe(false);
  });

  test("treats a whitespace-only forwarded header value as absent (still local)", () => {
    const req = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "  " },
    };
    expect(isLoopbackRequest(req)).toBe(true);
  });

  test("returns true for genuine direct loopback access (no forwarded headers)", () => {
    expect(isLoopbackRequest({ socket: { remoteAddress: "127.0.0.1" }, headers: {} })).toBe(true);
    expect(isLoopbackRequest({ socket: { remoteAddress: "::1" } })).toBe(true);
    expect(isLoopbackRequest({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: {} })).toBe(true);
  });

  test("X-Forwarded-Proto alone does not disqualify local access", () => {
    // nginx on the same box terminating TLS also sets X-Forwarded-Proto; the
    // proto header alone does not imply a forwarded client.
    const req = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-proto": "https" },
    };
    expect(isLoopbackRequest(req)).toBe(true);
  });
});

describe("parseUploadFileMetadata", () => {
  test("returns empty array for null", () => {
    expect(parseUploadFileMetadata(null)).toEqual([]);
  });

  test("returns empty array for undefined", () => {
    expect(parseUploadFileMetadata(undefined)).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(parseUploadFileMetadata("")).toEqual([]);
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseUploadFileMetadata("not json")).toEqual([]);
  });

  test("returns empty array when JSON value is not an array", () => {
    expect(parseUploadFileMetadata('{"foo":"bar"}')).toEqual([]);
    expect(parseUploadFileMetadata('"a string"')).toEqual([]);
    expect(parseUploadFileMetadata("42")).toEqual([]);
  });

  test("returns the parsed array for valid JSON array", () => {
    const input = JSON.stringify([{ name: "file.txt", size: 1024 }]);
    expect(parseUploadFileMetadata(input)).toEqual([
      { name: "file.txt", size: 1024 },
    ]);
  });

  test("returns an empty array for an empty JSON array", () => {
    expect(parseUploadFileMetadata("[]")).toEqual([]);
  });

  test("preserves multiple entries", () => {
    const files = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(parseUploadFileMetadata(JSON.stringify(files))).toEqual(files);
  });
});
