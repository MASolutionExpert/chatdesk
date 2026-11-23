import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useNewChatSearch } from "../../../src/hooks/chat/useNewChatSearch.js";

// Regression: users habitually type "@id" when searching in the new-DM modal.
// The hook must strip a leading "@" before calling the API — otherwise the
// search request carries "@..." patterns that match nobody and the modal
// shows "کاربری یافت نشد" for every ID.

const setup = async ({ searchUsers } = {}) => {
  const rendered = await renderHook(() =>
    useNewChatSearch({
      user: { username: "alice" },
      searchUsers,
      debounceMs: 10,
      maxResults: 5,
    }),
  );
  return rendered;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("useNewChatSearch strips leading @ from the query", () => {
  test("query '@bob' is sent as 'bob'", async () => {
    const searchUsers = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ users: [{ username: "bob" }] }),
    });
    const { result, act } = await setup({ searchUsers });

    await act(async () => {
      result.current.setNewChatOpen(true);
      result.current.setNewChatUsername("@bob");
    });
    await wait(80);

    expect(searchUsers).toHaveBeenCalled();
    expect(searchUsers.mock.calls[0][0].query).toBe("bob");
    expect(searchUsers.mock.calls[0][0].exclude).toBe("alice");
  });

  test("query 'BOB' is folded to lowercase 'bob'", async () => {
    const searchUsers = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ users: [] }),
    });
    const { result, act } = await setup({ searchUsers });

    await act(async () => {
      result.current.setNewChatOpen(true);
      result.current.setNewChatUsername("BOB");
    });
    await wait(80);

    expect(searchUsers).toHaveBeenCalled();
    expect(searchUsers.mock.calls[0][0].query).toBe("bob");
  });

  test("users who already share a chat with the searcher are NOT filtered out", async () => {
    // Regression: the old dmUsernames filter hid every existing chat partner
    // from the results. On helpdesk servers, support threads (type "dm",
    // channel "support") inflated that hidden set until EVERY search
    // reported "کاربری یافت نشد" even though the API returned matches.
    // Starting a DM with an existing partner re-opens that chat, so all
    // matches must stay visible.
    const searchUsers = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [{ username: "bob" }, { username: "carol" }],
      }),
    });
    const { result, act } = await setup({ searchUsers });

    await act(async () => {
      result.current.setNewChatOpen(true);
      result.current.setNewChatUsername("bob");
    });
    await wait(80);

    const usernames = result.current.newChatResults.map((u) => u.username);
    expect(usernames).toEqual(["bob", "carol"]);
  });
});
