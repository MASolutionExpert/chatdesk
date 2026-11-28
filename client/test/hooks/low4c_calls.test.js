import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDuplicateIncomingRing,
  isSignalForActiveCall,
} from "../../src/hooks/chat/useWebRTCCall.js";

const hookSource = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/hooks/chat/useWebRTCCall.js",
  ),
  "utf8",
);

// Task 4-c items S2/S1: call signals must be ignored while no call is active
// (a stale chat-id ref used to let stray offers create orphan peer
// connections and stray ICE candidates queue into the next call), and a
// duplicate call:incoming for the call we are already ringing for must be
// ignored instead of being rejected as "busy".

describe("isSignalForActiveCall", () => {
  test("rejects every signal while idle — even with a stale chat id", () => {
    expect(isSignalForActiveCall("idle", "chat-1", "chat-1")).toBe(false);
    expect(isSignalForActiveCall("idle", "chat-1", "chat-2")).toBe(false);
  });

  test("rejects signals when no chat is bound (ref empty)", () => {
    expect(isSignalForActiveCall("ringing", null, "chat-1")).toBe(false);
    expect(isSignalForActiveCall("calling", undefined, "chat-1")).toBe(false);
    expect(isSignalForActiveCall("connected", "", "chat-1")).toBe(false);
  });

  test("accepts matching-chat signals for every active call state", () => {
    ["calling", "ringing", "connected"].forEach((state) => {
      expect(isSignalForActiveCall(state, "chat-1", "chat-1")).toBe(true);
    });
  });

  test("rejects signals for another chat while a call is active", () => {
    expect(isSignalForActiveCall("connected", "chat-1", "chat-2")).toBe(false);
  });

  test("chat comparison is string-cased-insensitive-safe via String()", () => {
    expect(isSignalForActiveCall("connected", "CHAT-1", "chat-1")).toBe(false);
    expect(isSignalForActiveCall("connected", "chat-1", "chat-1")).toBe(true);
  });
});

describe("isDuplicateIncomingRing", () => {
  test("same chat while ringing → duplicate, ignore it", () => {
    expect(isDuplicateIncomingRing("ringing", "chat-1", "chat-1")).toBe(true);
  });

  test("different chat while ringing → a genuinely new call, reject busy", () => {
    expect(isDuplicateIncomingRing("ringing", "chat-1", "chat-2")).toBe(false);
  });

  test("same chat while calling/connected → not a duplicate (busy path)", () => {
    expect(isDuplicateIncomingRing("calling", "chat-1", "chat-1")).toBe(false);
    expect(isDuplicateIncomingRing("connected", "chat-1", "chat-1")).toBe(false);
  });

  test("idle → never a duplicate", () => {
    expect(isDuplicateIncomingRing("idle", "chat-1", "chat-1")).toBe(false);
  });

  test("no bound chat → never a duplicate", () => {
    expect(isDuplicateIncomingRing("ringing", null, "chat-1")).toBe(false);
  });
});

// Pattern simulation of the handleSignal decision branches (the repo
// convention for node-environment hook tests): the guards are the exact
// helpers wired into handleSignal below.
describe("handleSignal guard wiring", () => {
  const postSignal = vi.fn(async () => ({ ok: true }));

  const decideIncoming = (state, activeChatId, payload) => {
    if (state !== "idle") {
      if (isDuplicateIncomingRing(state, activeChatId, payload.chatId)) {
        return "ignored";
      }
      void postSignal("reject", { chatId: payload.chatId, reason: "busy" });
      return "busy";
    }
    return "ring";
  };

  const decideOffer = (state, activeChatId, payload) =>
    isSignalForActiveCall(state, activeChatId, payload.chatId)
      ? "processed"
      : "ignored";

  test("duplicate incoming while ringing for the same chat is ignored, no busy reject", () => {
    postSignal.mockClear();
    expect(decideIncoming("ringing", "chat-1", { chatId: "chat-1" })).toBe(
      "ignored",
    );
    expect(postSignal).not.toHaveBeenCalled();
  });

  test("incoming for another chat while ringing still rejects as busy", () => {
    postSignal.mockClear();
    expect(decideIncoming("ringing", "chat-1", { chatId: "chat-9" })).toBe(
      "busy",
    );
    expect(postSignal).toHaveBeenCalledWith("reject", {
      chatId: "chat-9",
      reason: "busy",
    });
  });

  test("stray offer while idle with a stale chat id is ignored", () => {
    // Regression: previously `callChatIdRef.current && mismatch → return`
    // PASSED when the ref was null, creating an orphan peer connection.
    expect(decideOffer("idle", null, { chatId: "chat-1" })).toBe("ignored");
    expect(decideOffer("idle", "stale-chat", { chatId: "stale-chat" })).toBe(
      "ignored",
    );
  });

  test("offer for the active chat while connected is processed", () => {
    expect(decideOffer("connected", "chat-1", { chatId: "chat-1" })).toBe(
      "processed",
    );
  });

  test("source wires the helpers into handleSignal", () => {
    // offer/answer/ice-candidate/camera-state/screen-share-state
    expect(hookSource.match(/isSignalForActiveCall\(/g)?.length).toBe(6);
    expect(hookSource).toMatch(/case "call:incoming"/);
    expect(hookSource).toMatch(/isDuplicateIncomingRing\(/);
  });
});
