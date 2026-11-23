import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  Close,
  CornerUpLeft,
  LoaderCircle,
  Search,
} from "../../icons/lucide.js";
import { hasPersian } from "../../utils/fontUtils.js";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { searchChatMessages } from "../../api/chatApi.js";
import { parseServerDate } from "../../utils/chatFormat.js";
import { useI18n } from "../../i18n/index.js";

/**
 * ChatSearchModal — full-history search inside ONE thread, opened from the
 * profile panel's "Search" action (next to "Files").
 *
 * Searches message text AND attachment file names from BOTH sides of the
 * thread (server-side, members only, same visibility contract as the files
 * gallery). Matches are case-insensitive, literal (no wildcard surprises) and
 * work for any character, word or number. Each result row shows the sender's
 * nickname, the message text with the match highlighted, and the full
 * original timestamp; clicking a row jumps to that message in the chat.
 * Results paginate with "load more".
 */
const PAGE_SIZE = 50;
const DEBOUNCE_MS = 350;

const formatFullTimestamp = (value, lang) => {
  const date = parseServerDate(value);
  if (!Number.isFinite(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const day = date.toLocaleDateString(lang === "fa" ? "fa-IR" : undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `${day} · ${time}`;
};

// Split text into [{ text, match }] segments for <mark> highlighting.
// Case-insensitive, literal — mirrors the server's escaped-LIKE semantics.
function buildSegments(text, term) {
  const haystack = String(text || "");
  const needle = String(term || "").toLowerCase();
  if (!needle) return [{ text: haystack, match: false }];
  const segments = [];
  let cursor = 0;
  let idx = haystack.toLowerCase().indexOf(needle, cursor);
  while (idx !== -1) {
    if (idx > cursor) segments.push({ text: haystack.slice(cursor, idx), match: false });
    segments.push({ text: haystack.slice(idx, idx + needle.length), match: true });
    cursor = idx + needle.length;
    idx = haystack.toLowerCase().indexOf(needle, cursor);
  }
  if (cursor < haystack.length) segments.push({ text: haystack.slice(cursor), match: false });
  return segments;
}

export default function ChatSearchModal({
  open,
  chatId,
  username,
  onClose,
  onJumpToMessage,
}) {
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);
  const { t, lang } = useI18n();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  // The term the CURRENT results were fetched for (avoids stale highlights).
  const [searchedTerm, setSearchedTerm] = useState("");
  const requestIdRef = useRef(0);
  const inputRef = useRef(null);

  // Reset state whenever the modal opens for a chat, and focus the input.
  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setResults([]);
    setTotal(0);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
    setError("");
    setSearchedTerm("");
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus?.();
    }, 50);
    return () => window.clearTimeout(focusTimer);
  }, [open, chatId]);

  // Debounced search — fires for any non-empty term (1+ characters).
  useEffect(() => {
    if (!open || !chatId || !username) return undefined;
    const term = query.trim().replace(/^@+/, "");
    if (!term) {
      setResults([]);
      setTotal(0);
      setHasMore(false);
      setError("");
      setSearchedTerm("");
      setLoading(false);
      return undefined;
    }
    const handle = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      let isCurrent = true;
      setLoading(true);
      setError("");
      searchChatMessages(chatId, username, term, { limit: PAGE_SIZE, offset: 0 })
        .then((res) =>
          res
            .json()
            .catch(() => ({}))
            .then((data) => ({ ok: res.ok, data })),
        )
        .then(({ ok, data }) => {
          if (!isCurrent || requestId !== requestIdRef.current) return;
          if (!ok) throw new Error(data?.error || t("modals.threadSearch.loadError"));
          setResults(Array.isArray(data?.results) ? data.results : []);
          setTotal(Number(data?.total || 0));
          setHasMore(Boolean(data?.hasMore));
          setSearchedTerm(term);
        })
        .catch(() => {
          if (isCurrent && requestId === requestIdRef.current) {
            setError(t("modals.threadSearch.loadError"));
          }
        })
        .finally(() => {
          if (isCurrent && requestId === requestIdRef.current) setLoading(false);
        });
      return () => {
        isCurrent = false;
      };
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [open, chatId, username, query, t]);

  const loadMore = () => {
    const term = searchedTerm;
    if (!chatId || !username || loadingMore || !hasMore || !term) return;
    setLoadingMore(true);
    searchChatMessages(chatId, username, term, {
      limit: PAGE_SIZE,
      offset: results.length,
    })
      .then((res) =>
        res
          .json()
          .catch(() => ({}))
          .then((data) => ({ ok: res.ok, data })),
      )
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.error || t("modals.threadSearch.loadError"));
        setResults((prev) => [...prev, ...(Array.isArray(data?.results) ? data.results : [])]);
        setTotal(Number(data?.total || 0));
        setHasMore(Boolean(data?.hasMore));
      })
      .catch(() => setError(t("modals.threadSearch.loadError")))
      .finally(() => setLoadingMore(false));
  };

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const jumpToMessage = (result) => {
    if (result?.messageId) onJumpToMessage?.(result.messageId);
  };

  const hasQuery = query.trim().replace(/^@+/, "").length > 0;
  const title = t("modals.threadSearch.title");

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 px-6 py-6"
      style={{
        minHeight: "100dvh",
        height: "100dvh",
        paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 1rem))",
        paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))",
        paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
        paddingRight: "max(1.5rem, env(safe-area-inset-right))",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-search-modal-title"
        className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-emerald-100/70 bg-white shadow-xl dark:border-emerald-500/30 dark:bg-slate-950"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/5">
          <h3
            id="chat-search-modal-title"
            className="flex items-center gap-2 text-lg font-semibold text-emerald-700 dark:text-emerald-200"
          >
            <Search size={18} className="text-emerald-500" />
            {title}
            {!loading && !error && searchedTerm ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300">
                {total.toLocaleString("en-US")}
              </span>
            ) : null}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center rounded-full border border-rose-200 p-2 text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 hover:shadow-[0_0_16px_rgba(244,63,94,0.2)] dark:border-rose-500/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
            aria-label={t("modals.threadSearch.close")}
          >
            <Close size={18} className="icon-anim-pop" />
          </button>
        </div>

        {/* Search input */}
        <div className="border-b border-slate-100 px-5 py-3 dark:border-white/5">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("modals.threadSearch.placeholder")}
              aria-label={t("modals.threadSearch.inputAria")}
              dir="auto"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-emerald-500/40 dark:focus:ring-emerald-500/10"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sb-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400">
              <LoaderCircle size={18} className="animate-spin text-emerald-500" />
              {t("modals.threadSearch.searching")}
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-rose-600 dark:text-rose-300">{error}</p>
          ) : !hasQuery ? (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("modals.threadSearch.emptyHint")}
            </p>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("modals.threadSearch.noResults")}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {results.map((result) => {
                  const senderName =
                    result.sender?.nickname || result.sender?.username || "";
                  const senderHasPersian = hasPersian(senderName);
                  const bodyHasPersian = hasPersian(result.body || "");
                  const segments = buildSegments(result.body, searchedTerm);
                  return (
                    <li key={`${result.messageId}`}>
                      <button
                        type="button"
                        onClick={() => jumpToMessage(result)}
                        className="w-full rounded-xl border border-slate-100 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-white/5 dark:hover:border-emerald-500/30 dark:hover:bg-emerald-500/5"
                        aria-label={`${t("modals.threadSearch.goToMessage")} — ${senderName}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate text-xs font-semibold text-emerald-700 dark:text-emerald-200 ${
                              senderHasPersian ? "font-fa" : ""
                            }`}
                            dir="auto"
                          >
                            {senderName}
                          </span>
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                            {formatFullTimestamp(result.sentAt, lang)}
                            <CornerUpLeft size={12} />
                          </span>
                        </div>
                        <p
                          className={`mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200 ${
                            bodyHasPersian ? "font-fa" : ""
                          }`}
                          dir="auto"
                        >
                          {segments.map((seg, i) =>
                            seg.match ? (
                              <mark
                                key={i}
                                className="rounded bg-emerald-100 px-0.5 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100"
                              >
                                {seg.text}
                              </mark>
                            ) : (
                              <span key={i}>{seg.text}</span>
                            ),
                          )}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mx-auto mt-4 mb-1 flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-default disabled:opacity-60 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
                >
                  {loadingMore ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : null}
                  {t("modals.threadSearch.loadMore")}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
