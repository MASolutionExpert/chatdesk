import { afterEach, describe, expect, test, vi } from "vitest";
import { createReadMarkerQueue } from "../../src/hooks/chat/useChatEvents.js";

// Task 4-c item S5: read bursts used to DROP mark-read for every message
// that arrived while a read-one request was in flight (the isMarkingReadRef
// guard), so the server marked only one message and the chat drifted unread.
// The queue must enqueue instead of dropping and flush after the in-flight
// request resolves.

afterEach(() => {
  vi.useRealTimers();
});

const makeQueue = (overrides = {}) => {
  const isMarkingReadRef = { current: false };
  const markMessageRead = vi.fn(async () => ({ ok: true }));
  const markMessagesRead = vi.fn(async () => ({ ok: true }));
  const usernameRef = { current: "alice" };
  const queue = createReadMarkerQueue({
    isMarkingReadRef,
    markMessageRead,
    markMessagesRead,
    usernameRef,
    ...overrides,
  });
  return { queue, isMarkingReadRef, markMessageRead, markMessagesRead, usernameRef };
};

describe("createReadMarkerQueue — burst of messages", () => {
  test("burst of 3 messages with a slow first request marks all 3 eventually", async () => {
    vi.useFakeTimers();
    const { queue, isMarkingReadRef, markMessageRead, markMessagesRead } =
      makeQueue();

    let resolveFirst;
    markMessageRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    queue.enqueue("chat-1", "aaaaaaaa-0000-4000-8000-000000000001");
    // First message goes out immediately as a read-one.
    expect(markMessageRead).toHaveBeenCalledTimes(1);
    expect(isMarkingReadRef.current).toBe(true);

    // The burst arrives while the first request is still in flight.
    queue.enqueue("chat-1", "aaaaaaaa-0000-4000-8000-000000000002");
    queue.enqueue("chat-1", "aaaaaaaa-0000-4000-8000-000000000003");
    // Queued — not dropped, and no parallel request fired.
    expect(markMessageRead).toHaveBeenCalledTimes(1);
    expect(markMessagesRead).not.toHaveBeenCalled();

    resolveFirst({ ok: true });
    await vi.runAllTimersAsync();

    // The queue flushed with a single chat-wide read request covering the
    // two queued ids, and the in-flight guard is released.
    expect(markMessagesRead).toHaveBeenCalledTimes(1);
    expect(markMessagesRead).toHaveBeenCalledWith({
      chatId: "chat-1",
      username: "alice",
    });
    expect(isMarkingReadRef.current).toBe(false);

    // Drained: another flush is a no-op.
    const callsBefore = markMessagesRead.mock.calls.length;
    queue.flush();
    expect(markMessagesRead.mock.calls.length).toBe(callsBefore);
    queue.dispose();
  });

  test("a single queued id flushes as a read-one for that id", async () => {
    vi.useFakeTimers();
    const { queue, isMarkingReadRef, markMessageRead, markMessagesRead } =
      makeQueue();

    let resolveFirst;
    markMessageRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    queue.enqueue("chat-1", "aaaaaaaa-0000-4000-8000-000000000001");
    queue.enqueue("chat-1", "aaaaaaaa-0000-4000-8000-000000000002");
    resolveFirst({ ok: true });
    await vi.runAllTimersAsync();

    expect(markMessageRead).toHaveBeenCalledTimes(2);
    expect(markMessageRead).toHaveBeenLastCalledWith({
      chatId: "chat-1",
      username: "alice",
      messageId: "aaaaaaaa-0000-4000-8000-000000000002",
    });
    expect(markMessagesRead).not.toHaveBeenCalled();
    expect(isMarkingReadRef.current).toBe(false);
    queue.dispose();
  });

  test("an enqueue without a messageId flushes as a chat-wide read", async () => {
    vi.useFakeTimers();
    const { queue, markMessageRead, markMessagesRead } = makeQueue();

    queue.enqueue("chat-1", null);
    await vi.runAllTimersAsync();

    expect(markMessageRead).not.toHaveBeenCalled();
    expect(markMessagesRead).toHaveBeenCalledWith({
      chatId: "chat-1",
      username: "alice",
    });
    queue.dispose();
  });

  test("enqueue while another owner holds the guard retries until it clears", async () => {
    vi.useFakeTimers();
    const { queue, isMarkingReadRef, markMessageRead, markMessagesRead } =
      makeQueue();

    // An external owner (scroll-driven mark-read in useChatScroll) is
    // mid-request when the burst arrives.
    isMarkingReadRef.current = true;
    queue.enqueue("chat-1", "aaaaaaaa-0000-4000-8000-000000000001");
    expect(markMessageRead).not.toHaveBeenCalled();

    isMarkingReadRef.current = false;
    await vi.runAllTimersAsync();

    expect(markMessageRead).toHaveBeenCalledTimes(1);
    expect(markMessageRead).toHaveBeenCalledWith({
      chatId: "chat-1",
      username: "alice",
      messageId: "aaaaaaaa-0000-4000-8000-000000000001",
    });
    expect(markMessagesRead).not.toHaveBeenCalled();
    queue.dispose();
  });

  test("failed flush requests never reject unhandled and still release the guard", async () => {
    vi.useFakeTimers();
    const isMarkingReadRef = { current: false };
    const markMessageRead = vi.fn(async () => Promise.reject(new Error("boom")));
    const markMessagesRead = vi.fn(async () => ({ ok: true }));
    const queue = createReadMarkerQueue({
      isMarkingReadRef,
      markMessageRead,
      markMessagesRead,
      usernameRef: { current: "alice" },
    });

    queue.enqueue("chat-1", "aaaaaaaa-0000-4000-8000-000000000001");
    await vi.runAllTimersAsync();

    expect(isMarkingReadRef.current).toBe(false);
    queue.dispose();
  });

  test("multiple chats flush sequentially, one at a time", async () => {
    vi.useFakeTimers();
    const { queue, isMarkingReadRef, markMessageRead } = makeQueue();

    let resolveFirst;
    markMessageRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    queue.enqueue("chat-1", "aaaaaaaa-0000-4000-8000-000000000001");
    queue.enqueue("chat-2", "aaaaaaaa-0000-4000-8000-000000000002");

    // Nothing runs in parallel: chat-2 waits for chat-1's request.
    expect(markMessageRead).toHaveBeenCalledTimes(1);
    resolveFirst({ ok: true });
    await vi.runAllTimersAsync();

    expect(markMessageRead).toHaveBeenCalledTimes(2);
    expect(markMessageRead).toHaveBeenLastCalledWith(
      expect.objectContaining({ chatId: "chat-2" }),
    );
    expect(isMarkingReadRef.current).toBe(false);
    queue.dispose();
  });
});
