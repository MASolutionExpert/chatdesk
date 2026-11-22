import { useEffect, useState } from "react";

export function useNewChatSearch({ user, searchUsers, debounceMs, maxResults }) {
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatUsername, setNewChatUsername] = useState("");
  const [newChatError, setNewChatError] = useState("");
  const [newChatResults, setNewChatResults] = useState([]);
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [newChatSelection, setNewChatSelection] = useState(null);

  useEffect(() => {
    if (!newChatOpen) return;
    if (!newChatUsername.trim()) {
      setNewChatResults([]);
      setNewChatSelection(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        setNewChatLoading(true);
        const res = await searchUsers({
          exclude: user.username,
          // Strip a leading "@" — users habitually type "@id" when searching.
          query: newChatUsername.trim().replace(/^@+/, "").toLowerCase(),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Unable to search users.");
        }
        // Show every match, including users the searcher already has a chat
        // with: starting a DM with an existing partner re-opens that chat
        // (POST /api/chats/dm reuses it), and hiding partners here made the
        // modal report "کاربری یافت نشد" for people who clearly exist —
        // especially on helpdesk servers where support threads (type "dm",
        // channel "support") inflated the hidden-partner set.
        const users = (data.users || []).slice(0, maxResults);
        setNewChatResults(users);
      } catch (err) {
        setNewChatError(err.message);
      } finally {
        setNewChatLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [
    debounceMs,
    maxResults,
    newChatOpen,
    newChatUsername,
    searchUsers,
    user.username,
  ]);

  return {
    newChatOpen,
    setNewChatOpen,
    newChatUsername,
    setNewChatUsername,
    newChatError,
    setNewChatError,
    newChatResults,
    setNewChatResults,
    newChatLoading,
    newChatSelection,
    setNewChatSelection,
  };
}
