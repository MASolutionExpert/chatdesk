import { beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useState } from "react";
import { useOverlayBack } from "../../../src/hooks/chat/useOverlayBack.js";

function BackHarness() {
  const [open, setOpen] = useState(false);
  const [closedByBack, setClosedByBack] = useState(false);
  useOverlayBack(
    open,
    () => {
      setClosedByBack(true);
      setOpen(false);
    },
    "sbChatOpen",
  );
  return (
    <>
      <button data-testid="open-chat" onClick={() => setOpen(true)}>
        open chat
      </button>
      <button data-testid="close-chat" onClick={() => setOpen(false)}>
        close chat
      </button>
      {open && <div data-testid="chat-view">chat</div>}
      {closedByBack && <div data-testid="closed-by-back">closed</div>}
    </>
  );
}

async function openChat() {
  render(<BackHarness />);
  await userEvent.click(page.getByTestId("open-chat"));
  await vi.waitFor(() => {
    expect(window.history.state?.sbChatOpen).toBe(true);
  });
}

beforeEach(() => {
  // Simulate the app's own SPA navigation history so a stray history.back()
  // while the fix is missing stays inside the test document.
  window.history.pushState(
    {
      sbBaseline: (window.__sbBaselineSeq = (window?.__sbBaselineSeq || 0) + 1),
    },
    "",
  );
  window.__sbBaselineMarker = window.history.state?.sbBaseline;
});

describe("useOverlayBack (Android system back)", () => {
  test("back gesture closes the open chat instead of exiting the app", async () => {
    await openChat();

    // The Android system back button behaves like history.back().
    window.history.back();

    await expect.element(page.getByTestId("chat-view")).not.toBeInTheDocument();
    await expect
      .element(page.getByTestId("closed-by-back"))
      .toBeInTheDocument();
    await vi.waitFor(() => {
      // The sentinel entry was popped; we land on the baseline entry.
      expect(window.history.state?.sbBaseline).toBe(window.__sbBaselineMarker);
    });
  });

  test("closing the chat with the close button pops the sentinel entry", async () => {
    await openChat();

    await userEvent.click(page.getByTestId("close-chat"));

    await expect.element(page.getByTestId("chat-view")).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(window.history.state?.sbBaseline).toBe(window.__sbBaselineMarker);
    });
  });

  test("one back gesture closes only the topmost overlay", async () => {
    function StackHarness() {
      const [stage, setStage] = useState("media");
      // Chat entry is pushed first, media entry on top — matches real usage.
      useOverlayBack(
        stage !== "closed",
        () => setStage("closed"), // close chat
        "sbChatOpen",
      );
      useOverlayBack(
        stage === "media",
        () => setStage("chat"), // close media, reveal the chat
        "sbMediaModal",
      );
      return (
        <>
          {stage === "media" && <div data-testid="media-open">media</div>}
          {stage !== "closed" && <div data-testid="chat-open">chat</div>}
        </>
      );
    }
    render(<StackHarness />);
    await vi.waitFor(() => {
      expect(window.history.state?.sbMediaModal).toBe(true);
    });

    window.history.back();

    // Media closes, chat stays open. One press, one thing.
    await expect
      .element(page.getByTestId("media-open"))
      .not.toBeInTheDocument();
    await expect.element(page.getByTestId("chat-open")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(window.history.state?.sbChatOpen).toBe(true);
    });

    window.history.back();

    await expect.element(page.getByTestId("chat-open")).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(window.history.state?.sbBaseline).toBe(window.__sbBaselineMarker);
    });
  });

  test("back gesture is ignored while no chat is open", async () => {
    render(<BackHarness />);

    window.history.back();

    await expect
      .element(page.getByTestId("closed-by-back"))
      .not.toBeInTheDocument();
    await vi.waitFor(() => {
      // Moved off our baseline entry (popped a foreign one); the hook must
      // have ignored the pop and closed nothing.
      expect(window.history.state?.sbBaseline).not.toBe(
        window.__sbBaselineMarker,
      );
    });
  });

  test("opening a modal while the context menu closes in the same commit keeps the modal open", async () => {
    // Regression: clicking "delete" in the context menu closed the menu
    // (history.back()) and opened the delete-scope modal (pushState) in the
    // same React commit. The menu's back() fired popstate AFTER the modal
    // pushed its sentinel, so the modal was instantly closed again — the
    // dialog "appeared and vanished" and nobody could delete a message.
    function MenuToModalHarness() {
      const [menuOpen, setMenuOpen] = useState(true);
      const [modalOpen, setModalOpen] = useState(false);
      useOverlayBack(menuOpen, () => setMenuOpen(false), "sbContextMenu");
      useOverlayBack(
        modalOpen,
        () => setModalOpen(false),
        "sbDeleteScopeModal",
      );
      return (
        <>
          {menuOpen && <div data-testid="menu-open">menu</div>}
          {modalOpen && <div data-testid="modal-open">modal</div>}
          <button
            data-testid="select-delete"
            onClick={() => {
              setMenuOpen(false);
              setModalOpen(true);
            }}
          >
            select delete
          </button>
        </>
      );
    }
    render(<MenuToModalHarness />);
    await vi.waitFor(() => {
      expect(window.history.state?.sbContextMenu).toBe(true);
    });

    await userEvent.click(page.getByTestId("select-delete"));

    // The modal must survive the menu's own history.back().
    await expect.element(page.getByTestId("menu-open")).not.toBeInTheDocument();
    await expect.element(page.getByTestId("modal-open")).toBeInTheDocument();
    expect(window.history.state?.sbDeleteScopeModal).toBe(true);

    // A genuine back gesture still closes the modal.
    window.history.back();
    await expect
      .element(page.getByTestId("modal-open"))
      .not.toBeInTheDocument();

    // The menu's sentinel was left stale (its pop was skipped because the
    // modal's sentinel landed on top of it in the same commit) — one more
    // back gesture drains it and we land on the baseline entry.
    window.history.back();
    await vi.waitFor(() => {
      expect(window.history.state?.sbBaseline).toBe(window.__sbBaselineMarker);
    });
  });

  test("closing a menu that sits above a modal keeps the chat underneath open", async () => {
    // Regression (1.6.0-dev.5): referred support group → member profile
    // modal open → the member context menu opens ON TOP of the modal;
    // selecting an item closed the menu (its own history.back()) and the
    // pop landed on the MODAL's live sentinel. The chat's old popstate
    // handler misread "new top is another LIVE sentinel" as "the pop went
    // past me" and called closeChat() — throwing the user out of the
    // conversation while the modal was still open.
    function MenuOverModalHarness() {
      const [stage, setStage] = useState("chat");
      useOverlayBack(
        stage !== "closed",
        () => setStage("closed"),
        "sbChatOpen",
      );
      useOverlayBack(
        stage === "modal" || stage === "menu",
        () => setStage("chat"),
        "sbChatProfileModal",
      );
      useOverlayBack(stage === "menu", () => setStage("modal"), "sbContextMenu");
      return (
        <>
          {stage !== "closed" && <div data-testid="chat-open">chat</div>}
          {(stage === "modal" || stage === "menu") && (
            <div data-testid="modal-open">modal</div>
          )}
          {stage === "menu" && <div data-testid="menu-open">menu</div>}
          <button data-testid="open-modal" onClick={() => setStage("modal")}>
            open modal
          </button>
          <button data-testid="open-menu" onClick={() => setStage("menu")}>
            open menu
          </button>
          <button data-testid="close-menu" onClick={() => setStage("modal")}>
            close menu
          </button>
        </>
      );
    }
    render(<MenuOverModalHarness />);
    await userEvent.click(page.getByTestId("open-modal"));
    await vi.waitFor(() => {
      expect(window.history.state?.sbChatProfileModal).toBe(true);
    });
    await userEvent.click(page.getByTestId("open-menu"));
    await vi.waitFor(() => {
      expect(window.history.state?.sbContextMenu).toBe(true);
    });

    // Closing the menu (e.g. selecting "Profile") must keep BOTH the modal
    // and the chat open.
    await userEvent.click(page.getByTestId("close-menu"));
    await expect
      .element(page.getByTestId("menu-open"))
      .not.toBeInTheDocument();
    await expect.element(page.getByTestId("modal-open")).toBeInTheDocument();
    await expect.element(page.getByTestId("chat-open")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(window.history.state?.sbChatProfileModal).toBe(true);
    });

    // A genuine back gesture still closes the modal, then the chat.
    window.history.back();
    await expect
      .element(page.getByTestId("modal-open"))
      .not.toBeInTheDocument();
    await expect.element(page.getByTestId("chat-open")).toBeInTheDocument();

    window.history.back();
    await expect
      .element(page.getByTestId("chat-open"))
      .not.toBeInTheDocument();
  });
});
