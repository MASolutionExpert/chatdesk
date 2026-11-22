import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  Close,
  FileText,
  Film,
  FolderOpen,
  Headphones,
  ImageIcon,
  LoaderCircle,
  ArrowDownToLine,
  ExternalLink,
  CornerUpLeft,
  MoreVertical,
} from "../../icons/lucide.js";
import { hasPersian } from "../../utils/fontUtils.js";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { fetchChatFiles } from "../../api/chatApi.js";
import { parseServerDate } from "../../utils/chatFormat.js";
import { useI18n } from "../../i18n/index.js";

/**
 * ChatFilesModal — the per-thread files gallery opened from the profile
 * panel's "Files" action.
 *
 * Lists every file sent in the thread by BOTH sides, newest first, each row
 * showing the media preview (or a kind icon), file name, size, the sender's
 * nickname and the full original timestamp (date + time). Every row has an
 * options menu: open in a new tab, download, and jump to the original
 * message in the chat. Pages are fetched on demand ("load more").
 */
const PAGE_SIZE = 60;

const KIND_ICONS = {
  image: ImageIcon,
  video: Film,
  audio: Headphones,
  document: FileText,
};

const formatFileSize = (sizeBytes) => {
  const bytes = Number(sizeBytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / kb))} KB`;
};

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

export default function ChatFilesModal({
  open,
  chatId,
  username,
  onClose,
  onJumpToMessage,
}) {
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);
  const { t, lang } = useI18n();

  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRef = useRef(null);

  // Close the per-row options menu on any outside interaction.
  useEffect(() => {
    if (!openMenuId) return undefined;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setOpenMenuId(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuId]);

  // Load the first page whenever the modal opens for a chat.
  useEffect(() => {
    if (!open || !chatId || !username) return undefined;
    let isMounted = true;
    setLoading(true);
    setError("");
    setFiles([]);
    setTotal(0);
    setHasMore(false);
    setOpenMenuId(null);
    fetchChatFiles(chatId, username, { limit: PAGE_SIZE, offset: 0 })
      .then((res) =>
        res
          .json()
          .catch(() => ({}))
          .then((data) => ({ ok: res.ok, data })),
      )
      .then(({ ok, data }) => {
        if (!isMounted) return;
        if (!ok) throw new Error(data?.error || t("modals.files.loadError"));
        setFiles(Array.isArray(data?.files) ? data.files : []);
        setTotal(Number(data?.total || 0));
        setHasMore(Boolean(data?.hasMore));
      })
      .catch(() => {
        if (isMounted) setError(t("modals.files.loadError"));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [open, chatId, username, t]);

  const loadMore = () => {
    if (!chatId || !username || loadingMore || !hasMore) return;
    setLoadingMore(true);
    fetchChatFiles(chatId, username, {
      limit: PAGE_SIZE,
      offset: files.length,
    })
      .then((res) =>
        res
          .json()
          .catch(() => ({}))
          .then((data) => ({ ok: res.ok, data })),
      )
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.error || t("modals.files.loadError"));
        setFiles((prev) => [...prev, ...(Array.isArray(data?.files) ? data.files : [])]);
        setTotal(Number(data?.total || 0));
        setHasMore(Boolean(data?.hasMore));
      })
      .catch(() => setError(t("modals.files.loadError")))
      .finally(() => setLoadingMore(false));
  };

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const openInNewTab = (file) => {
    setOpenMenuId(null);
    if (!file?.url) return;
    window.open(file.url, "_blank", "noopener,noreferrer");
  };

  const download = (file) => {
    setOpenMenuId(null);
    if (!file?.url) return;
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name || "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const jumpToMessage = (file) => {
    setOpenMenuId(null);
    if (file?.messageId) onJumpToMessage?.(file.messageId);
  };

  const title = t("modals.files.title");

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
        aria-labelledby="chat-files-modal-title"
        className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-emerald-100/70 bg-white shadow-xl dark:border-emerald-500/30 dark:bg-slate-950"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/5">
          <h3
            id="chat-files-modal-title"
            className="flex items-center gap-2 text-lg font-semibold text-emerald-700 dark:text-emerald-200"
          >
            <FolderOpen size={18} className="text-emerald-500" />
            {title}
            {!loading && !error ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300">
                {total.toLocaleString("en-US")}
              </span>
            ) : null}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center rounded-full border border-rose-200 p-2 text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 hover:shadow-[0_0_16px_rgba(244,63,94,0.2)] dark:border-rose-500/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
            aria-label={t("modals.files.close")}
          >
            <Close size={18} className="icon-anim-pop" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sb-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400">
              <LoaderCircle size={18} className="animate-spin text-emerald-500" />
              {t("common.actions.loading")}
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-rose-600 dark:text-rose-300">{error}</p>
          ) : files.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("modals.files.empty")}
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {files.map((file) => {
                  const KindIcon = KIND_ICONS[file.kind] || FileText;
                  const previewUrl =
                    (file.kind === "image" || file.kind === "video") && file.thumbUrl
                      ? file.thumbUrl
                      : null;
                  const isProcessing = Boolean(file.processing);
                  const senderName = file.sender?.nickname || file.sender?.username || "";
                  const nameHasPersian = hasPersian(file.name || "");
                  const senderHasPersian = hasPersian(senderName);
                  return (
                    <li
                      key={`${file.id}`}
                      className="relative flex items-center gap-3 rounded-xl border border-slate-100 p-2 pr-1 transition hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5"
                    >
                      {/* Preview / kind icon */}
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-white/5">
                        {previewUrl && !isProcessing ? (
                          <img
                            src={previewUrl}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <KindIcon size={22} className="text-slate-400 dark:text-slate-500" />
                        )}
                      </div>

                      {/* Name + sender + timestamp */}
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-sm font-medium text-slate-700 dark:text-slate-200 ${
                            nameHasPersian ? "font-fa" : ""
                          }`}
                          dir="auto"
                          title={file.name || ""}
                        >
                          {file.name || t("modals.files.unnamed")}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {senderName ? (
                            <span
                              className={`truncate font-medium text-slate-600 dark:text-slate-300 ${
                                senderHasPersian ? "font-fa" : ""
                              }`}
                              dir="auto"
                            >
                              {senderName}
                            </span>
                          ) : null}
                          {formatFileSize(file.sizeBytes) ? (
                            <span>{formatFileSize(file.sizeBytes)}</span>
                          ) : null}
                          {isProcessing ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300">
                              <LoaderCircle size={11} className="animate-spin" />
                              {t("modals.files.processing")}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                          {formatFullTimestamp(file.sentAt, lang)}
                        </p>
                      </div>

                      {/* Per-item options menu */}
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMenuId((prev) => (prev === file.id ? null : file.id))
                        }
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
                        aria-label={t("modals.files.options")}
                        aria-expanded={openMenuId === file.id}
                        aria-haspopup="menu"
                      >
                        <MoreVertical size={18} />
                      </button>
                      {openMenuId === file.id ? (
                        <div
                          ref={menuRef}
                          role="menu"
                          className="absolute right-2 top-11 z-10 w-44 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-slate-900"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => openInNewTab(file)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
                          >
                            <ExternalLink size={14} className="text-emerald-500" />
                            {t("modals.files.open")}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => download(file)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
                          >
                            <ArrowDownToLine size={14} className="text-emerald-500" />
                            {t("modals.files.download")}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => jumpToMessage(file)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
                          >
                            <CornerUpLeft size={14} className="text-emerald-500" />
                            {t("modals.files.goToMessage")}
                          </button>
                        </div>
                      ) : null}
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
                  {t("modals.files.loadMore")}
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
