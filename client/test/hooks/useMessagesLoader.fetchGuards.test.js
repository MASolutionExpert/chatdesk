import { describe, test, expect } from "vitest";
import {
  isCurrentMessageFetch,
  shouldTrackLastMessageId,
} from "../../src/hooks/chat/useMessagesLoader.js";

// ─── isCurrentMessageFetch (F8) ───────────────────────────────────────────────
// Only the live request may reset messageFetchInFlightRef / the messages
// spinner in loadMessages' finally block. An aborted (superseded) request
// therefore no longer clears the live request's state.

describe("useMessagesLoader — superseded fetch must not clear live state", () => {
  test("a superseded request id is not the live one", () => {
    // Request #1 started, request #2 superseded it (requestId counter = 2).
    expect(isCurrentMessageFetch(1, 2)).toBe(false);
  });

  test("the live request resets the shared state", () => {
    expect(isCurrentMessageFetch(2, 2)).toBe(true);
  });

  test("simulated interleaving: aborted request leaves in-flight set by the live one", () => {
    // Mirrors the finally-block contract in loadMessages:
    //   if (isCurrentMessageFetch(requestId, latestId)) { reset shared state }
    let messageFetchInFlightRef = true;
    let loadingMessages = true;

    const runFinally = (requestId, latestRequestId, options = {}) => {
      if (isCurrentMessageFetch(requestId, latestRequestId)) {
        messageFetchInFlightRef = false;
        if (!options.silent) loadingMessages = false;
      }
    };

    // Request 1 (non-silent) superseded by request 2 (non-silent).
    // Request 1's finally runs first — with the bug it cleared both flags.
    runFinally(1, 2);
    expect(messageFetchInFlightRef).toBe(true);
    expect(loadingMessages).toBe(true);

    // Request 2 (the live one) completes and resets state.
    runFinally(2, 2);
    expect(messageFetchInFlightRef).toBe(false);
    expect(loadingMessages).toBe(false);
  });
});

// ─── shouldTrackLastMessageId (F13) ───────────────────────────────────────────
// lastMessageIdRef (the tail anchor for hasNew/newFromSelf scroll-to-bottom)
// must not be overwritten with null (empty tail-delta) or with the last
// message of a mid-history unread-anchor window (afterId).

describe("useMessagesLoader — tail anchor update guard", () => {
  test("a normal fetch with a last id updates the anchor", () => {
    expect(shouldTrackLastMessageId({}, "msg-uuid-2")).toBe(true);
    expect(shouldTrackLastMessageId({ silent: true }, "msg-uuid-2")).toBe(true);
    expect(
      shouldTrackLastMessageId({ beforeId: "msg-uuid-1" }, "msg-uuid-2"),
    ).toBe(true);
  });

  test("an empty tail-delta fetch (no last id) does not blank the anchor", () => {
    expect(shouldTrackLastMessageId({ tailDelta: true }, null)).toBe(false);
    expect(shouldTrackLastMessageId({ tailDelta: true }, undefined)).toBe(false);
    expect(shouldTrackLastMessageId({ tailDelta: true }, "")).toBe(false);
  });

  test("a non-empty tail-delta fetch still updates the anchor", () => {
    expect(
      shouldTrackLastMessageId({ afterId: "msg-uuid-1", tailDelta: true }, "msg-uuid-9"),
    ).toBe(true);
  });

  test("an afterId unread-anchor load (mid-history window) never updates the anchor", () => {
    expect(
      shouldTrackLastMessageId(
        { afterId: "msg-uuid-5", forceUnreadFetch: true },
        "msg-uuid-14",
      ),
    ).toBe(false);
  });
});
