import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChevronDown, Globe, Lock, Megaphone, MessageCircleMore, Pencil, Plus, Trash, User, Users } from "../../icons/lucide.js";
import { api, cardCls, btnPrimary, iconBtn, fmtDate, DEFAULT_PAGE_SIZE } from "./adminShared.js";
import { LoadingRows, EmptyState, FilterPopover, SortTh, Pagination, TabToolbar, TabSearchInput } from "./AdminCommon.jsx";
import AdminGroupModal from "./AdminGroupModal.jsx";
import ConfirmModal from "../modals/ConfirmModal.jsx";
import Avatar from "../common/Avatar.jsx";
import VerifiedBadge from "../common/VerifiedBadge.jsx";
import Tooltip from "../common/Tooltip.jsx";
import { hasPersian } from "../../utils/fontUtils.js";
import { useOverlayBack } from "../../hooks/chat/useOverlayBack.js";
import { useI18n } from "../../i18n/index.js";

const ChatsTab = forwardRef(function ChatsTab({ active = true, onMutated, onStatsChange }, ref) {
  const { t } = useI18n();
  const [chats, setChats]             = useState([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(DEFAULT_PAGE_SIZE);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState("");
  const [typeFilter, setTypeFilter]   = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [verifiedFilter, setVerifiedFilter]     = useState("");
  const [autoAddFilter, setAutoAddFilter]       = useState("");
  const [remoteFilter, setRemoteFilter]         = useState("");
  const [sortBy, setSortBy]           = useState("id");
  const [sortDir, setSortDir]         = useState("ASC");
  const [editChat, setEditChat]       = useState(null);
  const [createType, setCreateType]   = useState(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const createMenuRef = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);
  // System back dismisses the create/edit modal instead of exiting.
  useOverlayBack(Boolean(createType), () => setCreateType(null), "sbAdminGroupModalCreate");
  useOverlayBack(Boolean(editChat), () => setEditChat(null), "sbAdminGroupModalEdit");

  useEffect(() => {
    if (!createMenuOpen) return undefined;
    const close = (e) => { if (!createMenuRef.current?.contains(e.target)) setCreateMenuOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setCreateMenuOpen(false); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", onKey); };
  }, [createMenuOpen]);

  // Fetch one page from the server. Sorting/filtering/search span the whole
  // groups+channels table server-side; `total` drives the pagination footer.
  const trimmedSearch = search.trim();
  const fetchPage = useCallback(async (targetPage) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const offset = (Math.max(1, targetPage) - 1) * pageSize;
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
      sortBy,
      sortDir,
    });
    if (trimmedSearch) params.set("search", trimmedSearch);
    if (typeFilter) params.set("type", typeFilter);
    if (visibilityFilter) params.set("visibility", visibilityFilter);
    if (verifiedFilter) params.set("verified", verifiedFilter);
    if (autoAddFilter) params.set("auto_add", autoAddFilter);
    if (remoteFilter) params.set("remote", remoteFilter);
    try {
      const data = await api.get(`/api/admin/chats?${params.toString()}`);
      if (requestId !== requestIdRef.current) return;
      setChats(data.chats ?? []);
      setTotal(Number(data.total || 0));
      setInitialized(true);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setInitialized(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [trimmedSearch, typeFilter, visibilityFilter, verifiedFilter, autoAddFilter, remoteFilter, sortBy, sortDir, pageSize]);

  // Refetch (debounced) whenever the query or page changes while the tab is visible.
  useEffect(() => {
    if (!active) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPage(page), 250);
    return () => clearTimeout(debounceRef.current);
  }, [active, page, fetchPage]);

  const refresh = useCallback(() => fetchPage(page), [fetchPage, page]);
  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  // Changing the query resets to page 1. This lives in the handlers (not an
  // effect) so re-revealing the tab via <Activity> — which re-runs effects but
  // keeps state — never resets the page the admin was already on.
  const changeSearch = (value) => { setSearch(value); setPage(1); };
  const changeTypeFilter = (value) => { setTypeFilter(value); setPage(1); };
  const changeVisibilityFilter = (value) => { setVisibilityFilter(value); setPage(1); };
  const changeVerifiedFilter = (value) => { setVerifiedFilter(value); setPage(1); };
  const changeAutoAddFilter = (value) => { setAutoAddFilter(value); setPage(1); };
  const changeRemoteFilter = (value) => { setRemoteFilter(value); setPage(1); };
  const changePageSize = (value) => { setPageSize(value); setPage(1); };
  const toggleSort = (field) => {
    setPage(1);
    setSortBy((prev) => {
      if (prev === field) { setSortDir((d) => (d === "DESC" ? "ASC" : "DESC")); return field; }
      setSortDir("DESC"); return field;
    });
  };

  const handleDelete = async (c) => {
    await api.delete(`/api/admin/chats/${c.id}`);
    refresh(); onMutated(); onStatsChange();
  };

  const chatFilterSections = [
    {
      id: "type",
      label: t("admin.chats.filters.type"),
      value: typeFilter,
      onChange: changeTypeFilter,
      options: [["", t("admin.chats.filters.allTypes")], ["dm", t("admin.chats.filters.typeDm")], ["group", t("admin.chats.filters.typeGroup")], ["channel", t("admin.chats.filters.typeChannel")]],
    },
    {
      id: "visibility",
      label: t("admin.chats.filters.visibility"),
      value: visibilityFilter,
      onChange: changeVisibilityFilter,
      options: [["", t("admin.chats.filters.allPrivacy")], ["public", t("admin.chats.filters.visPublic")], ["private", t("admin.chats.filters.visPrivate")]],
    },
    {
      id: "verified",
      label: t("admin.users.filters.verifiedStatus"),
      value: verifiedFilter,
      onChange: changeVerifiedFilter,
      options: [["", t("admin.common.all")], ["1", t("admin.common.verified")], ["0", t("admin.common.unverified")]],
    },
    {
      id: "autoAdd",
      label: t("admin.chats.filters.autoAdd"),
      value: autoAddFilter,
      onChange: changeAutoAddFilter,
      options: [["", t("admin.common.all")], ["1", t("admin.common.enabled")], ["0", t("admin.common.disabled")]],
    },
    {
      id: "remote",
      label: t("admin.chats.filters.remote"),
      value: remoteFilter,
      onChange: changeRemoteFilter,
      options: [
        ["", t("admin.chats.filters.allRemote")],
        ["active", t("admin.chats.filters.remoteActive")],
        ["paused", t("admin.chats.filters.remotePaused")],
        ["disabled", t("admin.common.disabled")],
        ["none", t("admin.chats.filters.remoteNone")],
      ],
    },
  ];

  const resetChatFilters = () => {
    setTypeFilter("");
    setVisibilityFilter("");
    setVerifiedFilter("");
    setAutoAddFilter("");
    setRemoteFilter("");
    setPage(1);
  };

  return (
    <div className="space-y-3">
      <TabToolbar>
        <TabSearchInput value={search} onChange={changeSearch} placeholder="admin.chats.search" />
        <FilterPopover sections={chatFilterSections} onReset={resetChatFilters} />
        <div ref={createMenuRef} className="relative shrink-0">
          <button type="button" onClick={() => setCreateMenuOpen((o) => !o)} aria-expanded={createMenuOpen}
            className={btnPrimary + " w-9 shrink-0 justify-center px-0 sm:w-auto sm:justify-start sm:px-3"}>
            <Plus size={16} className="icon-anim-pop shrink-0" /> <span className="hidden sm:inline">{t("admin.chats.newChat")}</span>
            <ChevronDown size={12} className={`hidden transition-transform sm:inline-flex ${createMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {createMenuOpen ? (
            <div className="absolute right-0 z-50 mt-1.5 w-44 overflow-hidden rounded-2xl border border-emerald-200 bg-white p-1 text-sm font-semibold text-slate-700 shadow-xl shadow-emerald-950/10 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-slate-100">
              <button type="button" onClick={() => { setCreateMenuOpen(false); setCreateType("group"); }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200">
                <Users size={15} className="text-emerald-500 icon-anim-sway" /> {t("admin.chats.newGroup")}
              </button>
              <button type="button" onClick={() => { setCreateMenuOpen(false); setCreateType("channel"); }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200">
                <Megaphone size={15} className="text-emerald-500 icon-anim-swing" /> {t("admin.chats.newChannel")}
              </button>
            </div>
          ) : null}
        </div>
      </TabToolbar>

      {!initialized ? <LoadingRows /> : chats.length === 0 ? <EmptyState message={t("admin.chats.empty")} /> : (
        <>
          {/* Mobile card list */}
          <div className="space-y-2 sm:hidden">
            {chats.map((c) => {
              const isDm = c.type === "dm";
              const chatName = isDm
                ? (c.participants || t("admin.chats.fallbackName", { id: c.id }))
                : (c.name || t("admin.chats.fallbackName", { id: c.id }));
              const nameHasPersian = hasPersian(chatName);
              return (
              <div key={c.id} className={"p-3 " + cardCls}>
                <div className="flex items-start gap-3">
                  <Avatar
                    src={isDm ? null : c.group_avatar_url}
                    name={chatName}
                    color={isDm ? "#10b981" : (c.group_color || "#10b981")}
                    className="h-10 w-10 shrink-0 text-sm font-bold text-white"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`flex items-center gap-0.5 truncate text-sm font-semibold text-slate-700 dark:text-slate-200`} dir="ltr">
                          <span className={`truncate ${nameHasPersian ? "font-fa" : ""}`} dir="auto">{chatName}</span>
                          {Boolean(c.verified) && <VerifiedBadge size={15} />}
                        </p>
                        {c.group_username && <p className="truncate text-[11px] text-slate-400">@{c.group_username}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!isDm && <Tooltip label={t("admin.common.edit")}><button type="button" onClick={() => setEditChat(c)} className={iconBtn("slate")}><Pencil size={16} /></button></Tooltip>}
                        <Tooltip label={t("admin.common.delete")}><button type="button" onClick={() => setPendingDelete(c)} className={iconBtn("rose")}><Trash size={16} /></button></Tooltip>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1 capitalize">
                        {c.type === "channel" ? <Megaphone size={12} className="text-emerald-500" /> : isDm ? <User size={12} className="text-emerald-500" /> : <Users size={12} className="text-emerald-500" />}
                        {isDm ? t("admin.chats.filters.typeDm") : c.type}
                      </span>
                      {!isDm && (
                        <span className="flex items-center gap-1 capitalize">
                          {(c.group_visibility || "public") === "private" ? <Lock size={12} className="text-emerald-500" /> : <Globe size={12} className="text-emerald-500" />}
                          {(c.group_visibility || "public") === "private" ? t("admin.chats.filters.visPrivate") : t("admin.chats.filters.visPublic")}
                        </span>
                      )}
                      <span className="flex items-center gap-1"><Users size={11} className="text-slate-400" />{c.member_count}</span>
                      <span className="flex items-center gap-1"><MessageCircleMore size={11} className="text-slate-400" />{c.message_count}</span>
                      <span className="text-slate-400 dark:text-slate-500">{fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className={"hidden overflow-hidden sm:block " + cardCls}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 dark:border-white/5">
                  <tr>
                    <SortTh field="name" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.chats.colChat")}</SortTh>
                    <SortTh field="type" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.chats.colType")}</SortTh>
                    <SortTh field="group_visibility" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.chats.colPrivacy")}</SortTh>
                    <SortTh field="member_count" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.chats.colMembers")}</SortTh>
                    <SortTh field="message_count" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.chats.colMessages")}</SortTh>
                    <SortTh field="created_at" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.chats.colCreated")}</SortTh>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">{t("admin.common.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-white/4">
                  {chats.map((c) => {
                    const isDm = c.type === "dm";
                    const chatName = isDm
                      ? (c.participants || t("admin.chats.fallbackName", { id: c.id }))
                      : (c.name || t("admin.chats.fallbackName", { id: c.id }));
                    const nameHasPersian = hasPersian(chatName);
                    return (
                    <tr key={c.id} className="hover:bg-emerald-50/30 dark:hover:bg-emerald-500/5">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            src={isDm ? null : c.group_avatar_url}
                            name={chatName}
                            color={isDm ? "#10b981" : (c.group_color || "#10b981")}
                            className="h-7 w-7 shrink-0 text-xs font-bold text-white"
                          />
                          <div className="min-w-0">
                            <p className={`flex items-center gap-0.5 truncate text-xs font-semibold text-slate-700 dark:text-slate-200`} dir="ltr">
                              <span className={`truncate ${nameHasPersian ? "font-fa" : ""}`} dir="auto">{chatName}</span>
                              {Boolean(c.verified) && <VerifiedBadge size={14} />}
                            </p>
                            {c.group_username && <p className="text-[11px] text-slate-400">@{c.group_username}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs capitalize text-slate-600 dark:text-slate-300">
                        <span className="flex items-center gap-1.5">
                          {c.type === "channel" ? <Megaphone size={13} className="text-emerald-500" /> : isDm ? <User size={13} className="text-emerald-500" /> : <Users size={13} className="text-emerald-500" />}
                          {isDm ? t("admin.chats.filters.typeDm") : c.type === "group" ? t("admin.chats.typeGroupSing") : c.type === "channel" ? t("admin.chats.typeChannelSing") : c.type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs capitalize text-slate-600 dark:text-slate-300">
                        {isDm ? (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            {(c.group_visibility || "public") === "private" ? <Lock size={13} className="text-emerald-500" /> : <Globe size={13} className="text-emerald-500" />}
                            {(c.group_visibility || "public") === "private" ? t("admin.chats.filters.visPrivate") : t("admin.chats.filters.visPublic")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                        <span className="flex items-center gap-1"><Users size={11} className="text-slate-400" />{c.member_count}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                        <span className="flex items-center gap-1"><MessageCircleMore size={11} className="text-slate-400" />{c.message_count}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-400 dark:text-slate-500">{fmtDate(c.created_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          {!isDm && (
                            <Tooltip label={t("admin.common.edit")}><button type="button" onClick={() => setEditChat(c)} className={iconBtn("slate")}><Pencil size={16} className="icon-anim-sway" /></button></Tooltip>
                          )}
                          <Tooltip label={t("admin.common.delete")}><button type="button" onClick={() => setPendingDelete(c)} className={iconBtn("rose")}><Trash size={16} className="icon-anim-slide" /></button></Tooltip>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage}
            onPageSizeChange={changePageSize} busy={loading} />
        </>
      )}

      {createType && <AdminGroupModal mode="create" initialType={createType} onClose={() => setCreateType(null)} onSaved={() => { refresh(); onMutated(); onStatsChange(); }} />}
      {editChat && <AdminGroupModal mode="edit" chat={editChat} onClose={() => setEditChat(null)} onSaved={() => { refresh(); onMutated(); }} />}
      <ConfirmModal
        open={Boolean(pendingDelete)}
        title={t("admin.chats.deleteTitle")}
        message={t("admin.chats.deleteConfirm", {
          name: pendingDelete?.type === "dm"
            ? (pendingDelete?.participants || t("admin.chats.fallbackName", { id: pendingDelete?.id }))
            : (pendingDelete?.name || t("admin.chats.fallbackName", { id: pendingDelete?.id })),
        })}
        confirmLabel={t("admin.common.delete")}
        onConfirm={async () => { await handleDelete(pendingDelete); setPendingDelete(null); }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
});

export default ChatsTab;
