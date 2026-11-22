import { describe, test, expect, vi, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import ChatFilesModal from "../../../src/components/modals/ChatFilesModal.jsx";
import { LanguageProvider } from "../../../src/i18n/index.js";

// These suites assert English UI strings, but the app UI defaults to
// Persian (fa). Pin the UI language to English and wrap the component in a
// LanguageProvider so t() resolves English labels.
function renderWithLang(ui) {
  try {
    window.localStorage.setItem("chatdesk.uiLanguage", "en");
  } catch {
    // storage unavailable — assertions below are the guardrail
  }
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

const CHAT_ID = "33333333-3333-4333-8333-333333333333";

function mockFetch(files, total = files.length, hasMore = false) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ chatId: CHAT_ID, files, total, hasMore }),
  });
}

const FILE_ROW = {
  id: 41,
  messageId: "55555555-5555-4555-8555-555555555555",
  kind: "document",
  name: "contract.pdf",
  mimeType: "application/pdf",
  processing: false,
  sizeBytes: 204800,
  width: null,
  height: null,
  durationSeconds: null,
  expiresAt: null,
  thumbUrl: null,
  url: "/api/uploads/messages/contract.pdf",
  sender: { username: "bob", nickname: "Bob", color: "#10b981", avatarUrl: null },
  sentAt: "2026-02-06T09:10:00.000Z",
};

describe("ChatFilesModal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("lists files with sender, size and timestamp", async () => {
    vi.stubGlobal("fetch", mockFetch([FILE_ROW]));
    renderWithLang(
      <ChatFilesModal
        open={true}
        chatId={CHAT_ID}
        username="alice"
        onClose={() => {}}
        onJumpToMessage={() => {}}
      />,
    );

    await expect
      .element(page.getByText("Shared files"))
      .toBeInTheDocument();
    await expect
      .element(page.getByText("contract.pdf"))
      .toBeInTheDocument();
    // sender nickname
    await expect.element(page.getByText("Bob")).toBeInTheDocument();
    // size (200 KB)
    await expect.element(page.getByText("200 KB")).toBeInTheDocument();
    // full timestamp: date + time on one line
    await expect
      .element(page.getByText(/2026/))
      .toBeInTheDocument();
  });

  test("shows the empty state when the thread has no files", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    renderWithLang(
      <ChatFilesModal
        open={true}
        chatId={CHAT_ID}
        username="alice"
        onClose={() => {}}
        onJumpToMessage={() => {}}
      />,
    );
    await expect
      .element(page.getByText("No files have been shared in this conversation yet."))
      .toBeInTheDocument();
  });

  test("per-row options menu opens and offers jump-to-message", async () => {
    const onJump = vi.fn();
    const userEvent = (await import("vitest/browser")).userEvent;
    vi.stubGlobal("fetch", mockFetch([FILE_ROW]));
    renderWithLang(
      <ChatFilesModal
        open={true}
        chatId={CHAT_ID}
        username="alice"
        onClose={() => {}}
        onJumpToMessage={onJump}
      />,
    );

    await expect.element(page.getByText("contract.pdf")).toBeInTheDocument();

    await userEvent.click(
      page.getByRole("button", { name: "File options" }).first(),
    );
    const menuitem = page.getByRole("menuitem", { name: "Go to message" });
    await expect.element(menuitem).toBeInTheDocument();

    await userEvent.click(menuitem);
    expect(onJump).toHaveBeenCalledWith(FILE_ROW.messageId);
  });

  test("shows the load-more button when the server reports more pages", async () => {
    vi.stubGlobal("fetch", mockFetch([FILE_ROW], 3, true));
    renderWithLang(
      <ChatFilesModal
        open={true}
        chatId={CHAT_ID}
        username="alice"
        onClose={() => {}}
        onJumpToMessage={() => {}}
      />,
    );
    await expect
      .element(page.getByRole("button", { name: "Load more" }))
      .toBeInTheDocument();
  });
});
