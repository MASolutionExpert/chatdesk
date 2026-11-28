import { describe, test, expect, vi } from "vitest";
import { isCallMediaStale } from "../../src/hooks/chat/useWebRTCCall.js";

// isCallMediaStale is the guard startCall/acceptCall run after
// `await acquireLocalMedia()`: the permission prompt can stay open while the
// call is torn down (user hangs up, peer cancels, ring resolved elsewhere).
// The freshly captured stream must then be stopped, never adopted.
describe("isCallMediaStale", () => {
  const liveCall = {
    callState: "calling",
    callEndReason: null,
    exitTimerPending: null,
  };

  test("a fresh call with an unchanged epoch is not stale", () => {
    expect(isCallMediaStale(3, 3, liveCall)).toBe(false);
  });

  test("a missing call snapshot is not stale by itself (epoch decides)", () => {
    expect(isCallMediaStale(3, 3)).toBe(false);
  });

  test("a teardown that happened during the await bumps the epoch", () => {
    // resetCallState / finishCall both increment the epoch; any mismatch
    // means the acquired stream belongs to a call that already ended.
    expect(isCallMediaStale(3, 4, liveCall)).toBe(true);
    expect(isCallMediaStale(4, 3, liveCall)).toBe(true);
  });

  test("an idle call state after the await means teardown already ran", () => {
    expect(
      isCallMediaStale(3, 3, { ...liveCall, callState: "idle" }),
    ).toBe(true);
  });

  test("a call end reason set during the await makes the stream stale", () => {
    expect(
      isCallMediaStale(3, 3, { ...liveCall, callEndReason: "ended" }),
    ).toBe(true);
    expect(
      isCallMediaStale(3, 3, { ...liveCall, callEndReason: "declined" }),
    ).toBe(true);
  });

  test("a pending exit timer (hang-up fade-out) makes the stream stale", () => {
    // beginCallExit schedules resetCallState via a timer id; while it is
    // pending the call is closing even though the state has not flipped yet.
    expect(
      isCallMediaStale(3, 3, { ...liveCall, exitTimerPending: 42 }),
    ).toBe(true);
  });

  test("epoch mismatch wins even when the other signals look healthy", () => {
    expect(isCallMediaStale(7, 8, { ...liveCall, callState: "ringing" })).toBe(
      true,
    );
  });
});

// Simulation of the startCall epoch pattern: teardown running while the
// permission prompt is open must stop the newly acquired tracks.
describe("startCall stale-media pattern", () => {
  test("stops the tracks of a stream granted after hang-up and never rings", async () => {
    const stop = vi.fn();
    const gotStream = { getTracks: () => [{ stop }] };
    const callEpochRef = { current: 5 };
    const callStateRef = { current: "calling" };
    const callEndReasonRef = { current: null };
    const endExitTimerRef = { current: null };
    const acquireLocalMedia = vi.fn(async () => ({
      stream: gotStream,
      hasVideo: true,
    }));
    const postSignal = vi.fn(async () => ({ ok: true }));
    const localStreamRef = { current: null };

    const startCall = async () => {
      callStateRef.current = "calling";
      const callEpoch = callEpochRef.current;
      const { stream } = await acquireLocalMedia(false);
      if (
        isCallMediaStale(callEpoch, callEpochRef.current, {
          callState: callStateRef.current,
          callEndReason: callEndReasonRef.current,
          exitTimerPending: endExitTimerRef.current,
        })
      ) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      await postSignal("start", { chatId: "chat-1" });
    };

    const pending = startCall();
    // The user hangs up while the permission prompt is open.
    callEpochRef.current += 1; // resetCallState
    await pending;

    expect(stop).toHaveBeenCalled();
    expect(localStreamRef.current).toBeNull();
    expect(postSignal).not.toHaveBeenCalled();
  });

  test("keeps the stream and sends start when the call is still live", async () => {
    const stop = vi.fn();
    const gotStream = { getTracks: () => [{ stop }] };
    const callEpochRef = { current: 5 };
    const callStateRef = { current: "calling" };
    const callEndReasonRef = { current: null };
    const endExitTimerRef = { current: null };
    const acquireLocalMedia = vi.fn(async () => ({
      stream: gotStream,
      hasVideo: true,
    }));
    const postSignal = vi.fn(async () => ({ ok: true }));
    const localStreamRef = { current: null };

    const startCall = async () => {
      callStateRef.current = "calling";
      const callEpoch = callEpochRef.current;
      const { stream } = await acquireLocalMedia(false);
      if (
        isCallMediaStale(callEpoch, callEpochRef.current, {
          callState: callStateRef.current,
          callEndReason: callEndReasonRef.current,
          exitTimerPending: endExitTimerRef.current,
        })
      ) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      await postSignal("start", { chatId: "chat-1" });
    };

    await startCall();

    expect(stop).not.toHaveBeenCalled();
    expect(localStreamRef.current).toBe(gotStream);
    expect(postSignal).toHaveBeenCalledWith("start", { chatId: "chat-1" });
  });
});
