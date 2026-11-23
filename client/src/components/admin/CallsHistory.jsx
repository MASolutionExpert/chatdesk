import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Phone, Video } from "../../icons/lucide.js";
import { api, cardCls, fmtDateTime, DEFAULT_PAGE_SIZE } from "./adminShared.js";
import { LoadingRows, EmptyState, FilterPopover, SortTh, Pagination, TabToolbar, TabSearchInput } from "./AdminCommon.jsx";
import Avatar from "../common/Avatar.jsx";
import { hasPersian } from "../../utils/fontUtils.js";
import { useI18n } from "../../i18n/index.js";

const STATUS_CHIP = {
  connected: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  outgoing: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  cancelled: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  declined: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  missed: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  failed: "bg-rose-500/20 text-rose-700 dark:text-rose-200",
};

const callLabel = (c) => {
  const name = c.chat_type === "dm"
    ? (c.participants || `#${c.chat_id?.slice(0, 8) || ""}`)
    : (c.chat_name || `#${c.chat_id?.slice(0, 8) || ""}`);
  return name;
};

const fmtDuration = (seconds, t) => {
  if (seconds == null) return "—";
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return t("admin.calls.durationExact", { m, s });
};

/**
 * Call-history report: every call (voice & video) logged anywhere in the
 * instance — caller, chat, type, outcome, duration and time — with search,
 * filters, sorting and server-side pagination. Rendered as the "Call history"
 * sub-view of the admin Chats tab.
 */
const CallsHistory = forwardRef(function CallsHistory({ active = true }, ref) {
  const { t } = useI18n();
  const [calls, setCalls]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(DEFAULT_PAGE_SIZE);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter]     = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy]         = useState("created_at");
  const [sortDir, setSortDir]       = useState("DESC");
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

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
    if (statusFilter) params.set("status", statusFilter);
    try {
      const data = await api.get(`/api/admin/calls?${params.toString()}`);
      if (requestId !== requestIdRef.current) return;
      setCalls(data.calls ?? []);
      setTotal(Number(data.total || 0));
      setInitialized(true);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setInitialized(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [trimmedSearch, typeFilter, statusFilter, sortBy, sortDir, pageSize]);

  // Refetch (debounced) whenever the query or page changes while visible.
  useEffect(() => {
    if (!active) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPage(page), 250);
    return () => clearTimeout(debounceRef.current);
  }, [active, page, fetchPage]);

  const refresh = useCallback(() => fetchPage(page), [fetchPage, page]);
  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  const changeSearch = (value) => { setSearch(value); setPage(1); };
  const changeTypeFilter = (value) => { setTypeFilter(value); setPage(1); };
  const changeStatusFilter = (value) => { setStatusFilter(value); setPage(1); };
  const changePageSize = (value) => { setPageSize(value); setPage(1); };
  const toggleSort = (field) => {
    setPage(1);
    setSortBy((prev) => {
      if (prev === field) { setSortDir((d) => (d === "DESC" ? "ASC" : "DESC")); return field; }
      setSortDir("DESC"); return field;
    });
  };

  const callFilterSections = [
    {
      id: "type",
      label: t("admin.calls.filters.type"),
      value: typeFilter,
      onChange: changeTypeFilter,
      options: [["", t("admin.calls.filters.allTypes")], ["audio", t("admin.calls.typeAudio")], ["video", t("admin.calls.typeVideo")]],
    },
    {
      id: "status",
      label: t("admin.calls.filters.status"),
      value: statusFilter,
      onChange: changeStatusFilter,
      options: [
        ["", t("admin.calls.filters.allStatuses")],
        ["connected", t("admin.calls.status.connected")],
        ["outgoing", t("admin.calls.status.outgoing")],
        ["cancelled", t("admin.calls.status.cancelled")],
        ["declined", t("admin.calls.status.declined")],
        ["missed", t("admin.calls.status.missed")],
        ["failed", t("admin.calls.status.failed")],
      ],
    },
  ];

  const resetCallFilters = () => {
    setTypeFilter("");
    setStatusFilter("");
    setPage(1);
  };

  const chatNameOf = (c) => {
    const name = callLabel(c, t);
    return name;
  };

  return (
    <div className="space-y-3">
      <TabToolbar>
        <TabSearchInput value={search} onChange={changeSearch} placeholder="admin.calls.search" />
        <FilterPopover sections={callFilterSections} onReset={resetCallFilters} />
      </TabToolbar>

      {!initialized ? <LoadingRows /> : calls.length === 0 ? <EmptyState message={t("admin.calls.empty")} /> : (
        <>
          {/* Mobile card list */}
          <div className="space-y-2 sm:hidden">
            {calls.map((c) => {
              const chatName = chatNameOf(c);
              const chatHasPersian = hasPersian(chatName);
              const StatusIcon = c.type === "video" ? Video : Phone;
              return (
                <div key={c.id} className={"p-3 " + cardCls}>
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={c.caller_avatar_url || null}
                      name={c.caller_nickname || c.caller_username}
                      color={c.caller_color || "#10b981"}
                      className="h-10 w-10 shrink-0 text-sm font-bold text-white"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-slate-700 dark:text-slate-200" dir="ltr">
                          <span className={hasPersian(c.caller_nickname || c.caller_username) ? "font-fa" : ""} dir="auto">
                            {c.caller_nickname || c.caller_username}
                          </span>
                        </p>
                        <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[c.status] || STATUS_CHIP.outgoing}`}>
                          <StatusIcon size={11} className="shrink-0" />
                          {t(`admin.calls.status.${c.status}`)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="min-w-0 max-w-full truncate" dir="auto">
                          {chatHasPersian ? <span className="font-fa">{chatName}</span> : chatName}
                        </span>
                        <span>{c.type === "video" ? t("admin.calls.typeVideo") : t("admin.calls.typeAudio")}</span>
                        <span>{fmtDuration(c.durationSeconds, t)}</span>
                        <span className="text-slate-400 dark:text-slate-500">{fmtDateTime(c.created_at)}</span>
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
                    <SortTh field="caller" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.calls.colCaller")}</SortTh>
                    <SortTh field="chat" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.calls.colChat")}</SortTh>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">{t("admin.calls.colType")}</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">{t("admin.calls.colStatus")}</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">{t("admin.calls.colDuration")}</th>
                    <SortTh field="created_at" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>{t("admin.calls.colDate")}</SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-white/4">
                  {calls.map((c) => {
                    const chatName = chatNameOf(c);
                    const chatHasPersian = hasPersian(chatName);
                    const StatusIcon = c.type === "video" ? Video : Phone;
                    return (
                      <tr key={c.id} className="hover:bg-emerald-50/30 dark:hover:bg-emerald-500/5">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar
                              src={c.caller_avatar_url || null}
                              name={c.caller_nickname || c.caller_username}
                              color={c.caller_color || "#10b981"}
                              className="h-7 w-7 shrink-0 text-xs font-bold text-white"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200" dir="auto">
                                <span className={hasPersian(c.caller_nickname || c.caller_username) ? "font-fa" : ""}>
                                  {c.caller_nickname || c.caller_username}
                                </span>
                              </p>
                              {c.caller_username && <p className="text-[11px] text-slate-400">@{c.caller_username}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[220px] px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                          <span className="block truncate" dir="auto">
                            {chatHasPersian ? <span className="font-fa">{chatName}</span> : chatName}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                          <span className="flex items-center gap-1.5">
                            {c.type === "video" ? <Video size={13} className="text-emerald-500" /> : <Phone size={13} className="text-emerald-500" />}
                            {c.type === "video" ? t("admin.calls.typeVideo") : t("admin.calls.typeAudio")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[c.status] || STATUS_CHIP.outgoing}`}>
                            <StatusIcon size={11} className="shrink-0" />
                            {t(`admin.calls.status.${c.status}`)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">{fmtDuration(c.durationSeconds, t)}</td>
                        <td className="px-4 py-2.5 text-[11px] text-slate-400 dark:text-slate-500">{fmtDateTime(c.created_at)}</td>
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
    </div>
  );
});

export default CallsHistory;
