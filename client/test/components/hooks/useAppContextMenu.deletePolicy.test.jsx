import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useAppContextMenu } from "../../../src/components/context-menu/useAppContextMenu.js";

// Deletion policy: regular users must never see the delete actions —
// not for messages, and not for DM-type threads (support tickets are
// DM chats). Moderators (owner/admin/operator) keep both entries.

const openMessageMenu = async (rendered) => {
  const { result, act } = rendered;
  await act(async () => {
    result.current.openContextMenu({
      kind: "message",
      data: { message: { id: "m1", username: "bob", body: "hello" } },
      targetEl: null,
      event: { clientX: 10, clientY: 10 },
    });
  });
  return result.current.contextMenu;
};

const openChatMenu = async (rendered, chat) => {
  const { result, act } = rendered;
  await act(async () => {
    result.current.openContextMenu({
      kind: "chat",
      data: { chat },
      targetEl: null,
      event: { clientX: 10, clientY: 10 },
    });
  });
  return result.current.contextMenu;
};

const idsOf = (menu) => (menu?.items || []).map((item) => item.id);

describe("useAppContextMenu — delete policy", () => {
  const baseProps = {
    activeChatId: "chat-1",
    chats: [],
    currentUsername: "alice",
    onDeleteMessage: vi.fn(),
    onDeleteChats: vi.fn(),
  };

  test("moderator sees the message delete entry", async () => {
    const rendered = await renderHook(() =>
      useAppContextMenu({ ...baseProps, canDeleteMessages: true }),
    );
    const menu = await openMessageMenu(rendered);
    expect(idsOf(menu)).toContain("delete");
  });

  test("regular user has no message delete entry", async () => {
    const rendered = await renderHook(() =>
      useAppContextMenu({ ...baseProps, canDeleteMessages: false }),
    );
    const menu = await openMessageMenu(rendered);
    expect(idsOf(menu)).not.toContain("delete");
  });

  test("regular user has no delete entry for a DM thread", async () => {
    const canDeleteChatThread = (chat) =>
      String(chat?.type || "").toLowerCase() !== "dm";
    const rendered = await renderHook(() =>
      useAppContextMenu({
        ...baseProps,
        canDeleteChatThread,
      }),
    );
    const menu = await openChatMenu(rendered, { id: "c1", type: "dm" });
    expect(idsOf(menu)).not.toContain("delete");
  });

  test("regular user keeps the delete entry for group chats (leave + hide)", async () => {
    const canDeleteChatThread = (chat) =>
      String(chat?.type || "").toLowerCase() !== "dm";
    const rendered = await renderHook(() =>
      useAppContextMenu({
        ...baseProps,
        canDeleteChatThread,
      }),
    );
    const menu = await openChatMenu(rendered, { id: "c1", type: "group" });
    expect(idsOf(menu)).toContain("delete");
  });

  test("moderator keeps the delete entry for a DM thread", async () => {
    const canDeleteChatThread = () => true;
    const rendered = await renderHook(() =>
      useAppContextMenu({
        ...baseProps,
        canDeleteChatThread,
      }),
    );
    const menu = await openChatMenu(rendered, { id: "c1", type: "dm" });
    expect(idsOf(menu)).toContain("delete");
  });
});
