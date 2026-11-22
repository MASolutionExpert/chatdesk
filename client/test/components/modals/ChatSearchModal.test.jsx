import { describe, test, expect, vi, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import ChatSearchModal from "../../../src/components/modals/ChatSearchModal.jsx";
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

const CHAT_ID = "77777777-7777-4777-8777-777777777777";

function mockSearch(results, total = results.length, hasMore = false) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ chatId: CHAT_ID, query: "x", results, total, hasMore }),
  });
}

const RESULT_ROW = {
  messageId: "88888888-8888-4888-8888-888888888888",
  body: "please check invoice #42 today",
  sentAt: "2026-02-06T09:10:00.000Z",
  sender: { username: "bob", nickname: "Bob", color: "#10b981", avatarUrl: null },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("ChatSearchModal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("searches after typing and shows results with sender + jump", async () => {
    const fetchMock = mockSearch([RESULT_ROW]);
    vi.stubGlobal("fetch", fetchMock);
    const onJumpToMessage = vi.fn();

    renderWithLang(
      <ChatSearchModal
        open={true}
        chatId={CHAT_ID}
        username="alice"
        onClose={() => {}}
        onJumpToMessage={onJumpToMessage}
      />,
    );

    await expect
      .element(page.getByText("Search in conversation"))
      .toBeInTheDocument();

    // Empty query → hint, no fetch yet
    await expect
      .element(page.getByText(/Type any character, word or number/))
      .toBeInTheDocument();

    const input = page.getByLabelText("Search this conversation");
    await input.fill("invoice");

    // Debounced (350ms) search fires
    await expect
      .element(page.getByText("please check invoice #42 today"))
      .toBeInTheDocument();
    await expect.element(page.getByText("Bob")).toBeInTheDocument();

    // Clicking the result row jumps to the message
    await page
      .getByRole("button", { name: /Go to message — Bob/ })
      .click();
    expect(onJumpToMessage).toHaveBeenCalledWith(RESULT_ROW.messageId);
  });

  test("shows the empty state when the term matches nothing", async () => {
    vi.stubGlobal("fetch", mockSearch([]));
    renderWithLang(
      <ChatSearchModal
        open={true}
        chatId={CHAT_ID}
        username="alice"
        onClose={() => {}}
        onJumpToMessage={() => {}}
      />,
    );

    const input = page.getByLabelText("Search this conversation");
    await input.fill("zzz-nothing");

    await expect
      .element(page.getByText("No results in this conversation."))
      .toBeInTheDocument();
  });
});
