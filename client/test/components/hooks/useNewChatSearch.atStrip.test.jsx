import { describe, expect, test, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useNewChatSearch } from "../../../src/hooks/chat/useNewChatSearch.js";

// Regression: users habitually type "@id" when searching in the new-DM modal.
// The hook must strip a leading "@" before calling the API — otherwise the
// search request carries "@..." patterns that match nobody and the modal
// shows "کاربری یافت نشد" for every ID.

const setup = async ({ searchUsers, dmUsernames = new Set() } = {}) => {
  const rendered = await renderHook(() =>
    useNewChatSearch({
      user: { username: "alice" },
      dmUsernamesRef: { current: dmUsernames },
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

  test("users already in a DM list are filtered from the results", async () => {
    const searchUsers = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [{ username: "bob" }, { username: "carol" }],
      }),
    });
    const { result, act } = await setup({
      searchUsers,
      dmUsernames: new Set(["bob"]),
    });

    await act(async () => {
      result.current.setNewChatOpen(true);
      result.current.setNewChatUsername("bob");
    });
    await wait(80);

    const usernames = result.current.newChatResults.map((u) => u.username);
    expect(usernames).toEqual(["carol"]);
  });
});
