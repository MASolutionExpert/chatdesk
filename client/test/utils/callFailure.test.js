import { describe, it, expect, afterEach, vi } from "vitest";
import { classifyMediaError } from "../../src/utils/callCapabilities.js";
import {
  isTurnConfigured,
  describeIceFailure,
} from "../../src/hooks/chat/useWebRTCCall.js";

describe("classifyMediaError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withNavigator = (mediaDevices) => {
    vi.stubGlobal("navigator", { mediaDevices });
    vi.stubGlobal("window", { isSecureContext: true });
  };

  it("reports an insecure context when getUserMedia is missing entirely", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { isSecureContext: false });
    expect(classifyMediaError(new Error("anything"))).toBe("media-secure");
  });

  it("maps NotAllowedError to a permission problem", () => {
    withNavigator({ getUserMedia: async () => {} });
    const err = new Error("denied");
    err.name = "NotAllowedError";
    expect(classifyMediaError(err)).toBe("media-permission");
  });

  it("maps PermissionDeniedError and SecurityError to a permission problem", () => {
    withNavigator({ getUserMedia: async () => {} });
    const denied = new Error("x");
    denied.name = "PermissionDeniedError";
    const security = new Error("x");
    security.name = "SecurityError";
    expect(classifyMediaError(denied)).toBe("media-permission");
    expect(classifyMediaError(security)).toBe("media-permission");
  });

  it("maps NotFoundError to a missing device", () => {
    withNavigator({ getUserMedia: async () => {} });
    const err = new Error("none");
    err.name = "NotFoundError";
    expect(classifyMediaError(err)).toBe("media-device");
  });

  it("maps NotReadableError to a busy device", () => {
    withNavigator({ getUserMedia: async () => {} });
    const err = new Error("busy");
    err.name = "NotReadableError";
    expect(classifyMediaError(err)).toBe("media-busy");
  });

  it("falls back to media-unknown for unnamed errors in a secure context", () => {
    withNavigator({ getUserMedia: async () => {} });
    expect(classifyMediaError(new Error("boom"))).toBe("media-unknown");
  });

  it("falls back to media-secure for unnamed errors in an insecure context", () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => {} } });
    vi.stubGlobal("window", { isSecureContext: false });
    expect(classifyMediaError(new Error("boom"))).toBe("media-secure");
  });
});

describe("isTurnConfigured", () => {
  it("detects a turn: url", () => {
    expect(
      isTurnConfigured([{ urls: "turn:turn.example.com:3478", username: "u" }]),
    ).toBe(true);
  });

  it("detects turns: in a url array", () => {
    expect(
      isTurnConfigured([{ urls: ["stun:stun.l.google.com:19302", "turns:relay.example.com:443"] }]),
    ).toBe(true);
  });

  it("is false for a STUN-only list", () => {
    expect(isTurnConfigured([{ urls: "stun:stun.l.google.com:19302" }])).toBe(
      false,
    );
  });

  it("is false for empty or missing lists", () => {
    expect(isTurnConfigured([])).toBe(false);
    expect(isTurnConfigured(undefined)).toBe(false);
  });
});

describe("describeIceFailure", () => {
  it("verdict relay when a relay candidate was gathered", () => {
    expect(
      describeIceFailure({
        candidates: ["host", "relay"],
        turnConfigured: true,
        ice: "failed",
      }),
    ).toMatchObject({ kind: "ice", verdict: "relay", turnConfigured: true });
  });

  it("verdict srflx when only STUN worked (no TURN)", () => {
    const detail = describeIceFailure({
      candidates: ["host", "srflx"],
      turnConfigured: false,
    });
    expect(detail.verdict).toBe("srflx");
    expect(detail.turnConfigured).toBe(false);
    expect(detail.kind).toBe("ice");
  });

  it("verdict host when even STUN failed (UDP blocked)", () => {
    expect(describeIceFailure({ candidates: ["host"] }).verdict).toBe("host");
  });

  it("verdict none when nothing was gathered", () => {
    expect(describeIceFailure({ candidates: [] }).verdict).toBe("none");
  });

  it("keeps candidate types unique and lower-cased", () => {
    const detail = describeIceFailure({
      candidates: ["srflx", "srflx", "HOST"],
    });
    expect(detail.candidates).toEqual(["srflx", "host"]);
  });
});
