import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Ban,
  Brush,
  CirclePlus,
  HardDriveDownload,
  HardDriveUpload,
  History,
  KeyRound,
  LogIn,
  MessageCircleX,
  Pencil,
  Plus,
  Power,
  Refresh,
  Rotate,
  Send,
  Settings,
  ShieldCheck,
  ShieldOff,
  Tag,
  Trash,
  Unplug,
  UserMinus,
  UserPlus,
  Zap,
} from "../../icons/lucide.js";
import { api, cardCls, btnDanger, fmtDateTime, DEFAULT_PAGE_SIZE } from "./adminShared.js";
import { LoadingRows, EmptyState, Pagination, TabToolbar, TabSearchInput } from "./AdminCommon.jsx";
import ConfirmModal from "../modals/ConfirmModal.jsx";
import { hasPersian } from "../../utils/fontUtils.js";
import { useI18n } from "../../i18n/index.js";

// `label` holds an i18n key (admin.logs.actions.*) — translated at render time.
const LOG_ACTION_META = {
  "user.create":                        { label: "admin.logs.actions.userCreate",                color: "emerald", icon: UserPlus },
  "user.edit":                          { label: "admin.logs.actions.userEdit",                 color: "slate",   icon: Pencil },
  "user.delete":                        { label: "admin.logs.actions.userDelete",                color: "rose",    icon: Trash },
  "user.ban":                           { label: "admin.logs.actions.userBan",                 color: "rose",    icon: Ban },
  "user.unban":                         { label: "admin.logs.actions.userUnban",               color: "emerald", icon: CirclePlus },
  "user.role":                          { label: "admin.logs.actions.userRole",                color: "emerald", icon: Tag },
  "user.reset_password":                { label: "admin.logs.actions.userResetPassword",              color: "slate",   icon: KeyRound },
  "chat.create":                        { label: "admin.logs.actions.chatCreate",                color: "emerald", icon: Plus },
  "chat.edit":                          { label: "admin.logs.actions.chatEdit",                 color: "slate",   icon: Pencil },
  "chat.delete":                        { label: "admin.logs.actions.chatDelete",                color: "rose",    icon: Trash },
  "chat.member_add":                    { label: "admin.logs.actions.memberAdd",                color: "emerald", icon: UserPlus },
  "chat.member_remove":                 { label: "admin.logs.actions.memberRemove",                 color: "rose",    icon: UserMinus },
  "chat.member_role":                   { label: "admin.logs.actions.memberRole",                 color: "slate",   icon: Tag },
  "db.vacuum":                          { label: "admin.logs.actions.dbVacuum",                 color: "emerald", icon: Brush },
  "db.clear_messages":                  { label: "admin.logs.actions.dbClearMessages",            color: "rose",    icon: MessageCircleX },
  "db.reset":                           { label: "admin.logs.actions.dbReset",                    color: "rose",    icon: Rotate },
  "db.backup":                          { label: "admin.logs.actions.dbBackup",               color: "emerald", icon: HardDriveDownload },
  "db.restore":                         { label: "admin.logs.actions.dbRestore",               color: "slate",   icon: HardDriveUpload },
  "service.restart":                    { label: "admin.logs.actions.serviceRestart",           color: "emerald", icon: Refresh },
  "service.stop":                       { label: "admin.logs.actions.serviceStop",             color: "rose",    icon: Power },
  "logs.clear":                         { label: "admin.logs.actions.logsClear",                color: "rose",    icon: Trash },
  "settings.update":                    { label: "admin.logs.actions.settingsUpdate",             color: "emerald", icon: Settings },
  "settings.reset":                     { label: "admin.logs.actions.settingsReset",             color: "slate",   icon: Rotate },
  "admin.claim_success":                { label: "admin.logs.actions.adminClaimSuccess",               color: "emerald", icon: ShieldCheck },
  "admin.claim_failed":                 { label: "admin.logs.actions.adminClaimFailed",             color: "rose",    icon: ShieldOff },
  "remoteChannel.test":                 { label: "admin.logs.actions.remoteTest",       color: "slate",   icon: Zap },
  "remoteChannel.setup_code_sent":      { label: "admin.logs.actions.remoteCodeSent",             color: "emerald", icon: Send },
  "remoteChannel.setup_code_failed":    { label: "admin.logs.actions.remoteCodeFailed",         color: "rose",    icon: Send },
  "remoteChannel.setup_signed_in":      { label: "admin.logs.actions.remoteSignedIn",          color: "emerald", icon: LogIn },
  "remoteChannel.setup_sign_in_failed": { label: "admin.logs.actions.remoteSignInFailed",           color: "rose",    icon: LogIn },
  "remoteChannel.disconnected":         { label: "admin.logs.actions.remoteDisconnected", color: "rose",    icon: Unplug },
  "nginx.reload":                       { label: "admin.logs.actions.nginxReload",               color: "emerald", icon: Refresh },
};

const LOG_COLORS = {
  emerald: { icon: "text-emerald-600 dark:text-emerald-400" },
  rose:    { icon: "text-rose-500 dark:text-rose-400" },
  slate:   { icon: "text-slate-500 dark:text-slate-400" },
};

// All possible log sources in display order. `label` holds an i18n key.
const ALL_LOG_SOURCES = [
  { id: "admin",     label: "admin.logs.sources.admin" },
  { id: "installer", label: "admin.logs.sources.installer" },
  { id: "service",   label: "admin.logs.sources.service" },
  { id: "worker",    label: "admin.logs.sources.worker" },
  { id: "nginx",     label: "admin.logs.sources.nginx" },
];

// ─── Admin audit log ──────────────────────────────────────────────────────────

// `cachedData`  — { logs, total } from the parent cache (may be null on first load)
// `onFetched`   — parent callback to store fresh data: (page, pageSize, search, data) => void
// `active`      — whether this tab is visible
const AdminLogView = forwardRef(function AdminLogView({ currentUser, active = true, cachedData, onFetched }, ref) {
  const { t } = useI18n();
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing]       = useState(false);
  const debounceRef  = useRef(null);
  const requestIdRef = useRef(0);

  const isOwner = currentUser?.role === "owner";

  // Derive display data from cache. While the first fetch is in-flight,
  // cachedData is null → show LoadingRows. After that, stale data stays
  // visible while a background refresh runs (loading=true but data shown).
  const logs      = cachedData?.logs  ?? null;
  const total     = cachedData?.total ?? 0;
  const initialized = logs !== null;

  const trimmedSearch = search.trim();
  const fetchPage = useCallback(async (targetPage) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const offset = (Math.max(1, targetPage) - 1) * pageSize;
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (trimmedSearch) params.set("search", trimmedSearch);
    try {
      const data = await api.get(`/api/admin/logs?${params.toString()}`);
      if (requestId !== requestIdRef.current) return;
      onFetched?.({ logs: data.logs ?? [], total: Number(data.total || 0) });
    } catch {
      // Leave stale cache intact on error
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [trimmedSearch, pageSize, onFetched]);

  useEffect(() => {
    if (!active) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPage(page), 250);
    return () => clearTimeout(debounceRef.current);
  }, [active, page, fetchPage]);

  const refresh = useCallback(() => fetchPage(page), [fetchPage, page]);
  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  const changeSearch   = (value) => { setSearch(value);   setPage(1); };
  const changePageSize = (value) => { setPageSize(value); setPage(1); };

  const clearLogs = async () => {
    setClearing(true);
    try { await api.delete("/api/admin/logs"); setPage(1); refresh(); }
    finally { setClearing(false); setConfirmOpen(false); }
  };

  return (
    <div className="space-y-3">
      <TabToolbar>
        <TabSearchInput value={search} onChange={changeSearch} placeholder="admin.logs.search" />
        {isOwner && (
          <button type="button" onClick={() => setConfirmOpen(true)}
            className={btnDanger + " w-9 shrink-0 justify-center px-0 sm:w-auto sm:justify-start sm:px-3"}>
            <Trash size={16} className="icon-anim-slide shrink-0" />
            <span className="hidden sm:inline">{t("admin.logs.clear")}</span>
          </button>
        )}
      </TabToolbar>

      <ConfirmModal
        open={confirmOpen}
        title={t("admin.logs.clearTitle")}
        message={t("admin.logs.clearMsg")}
        confirmLabel={t("admin.logs.clear")}
        busy={clearing}
        onConfirm={clearLogs}
        onClose={() => setConfirmOpen(false)}
      />

      {!initialized ? <LoadingRows /> : logs.length === 0 ? <EmptyState message={t("admin.logs.empty")} /> : (
        <>
          <div className={"overflow-hidden " + cardCls}>
            {logs.map((entry, i) => {
              const meta   = LOG_ACTION_META[entry.action] || { label: entry.action, color: "slate", icon: History };
              const Icon   = meta.icon || History;
              const colors = LOG_COLORS[meta.color] || LOG_COLORS.slate;
              const detailText      = [entry.targetLabel, entry.details].filter(Boolean).join(" · ");
              const detailHasPersian = hasPersian(detailText);
              return (
                <div key={i} className={`flex items-start gap-3 px-4 py-3 ${i < logs.length - 1 ? "border-b border-slate-100 dark:border-white/5" : ""}`}>
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center ${colors.icon}`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{t(meta.label)}</span>
                      {entry.status === "error" && <span className="text-[10px] font-semibold text-rose-500">{t("admin.logs.failed")}</span>}
                    </div>
                    <p className={`mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500 ${detailHasPersian ? "font-fa" : ""}`} dir="ltr">
                      <bdi>{detailText}</bdi>
                      {detailText ? " · " : ""}
                      {entry.actorUsername ? `@${entry.actorUsername}` : t("admin.logs.system")} · {fmtDateTime(entry.ts)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage}
            onPageSizeChange={changePageSize} busy={loading} />
        </>
      )}
    </div>
  );
});

// ─── System log viewer (installer / service / nginx) ─────────────────────────

// `cachedData`  — { available, lines, reason, source } from parent cache (null = not yet loaded)
// `onFetched`   — parent callback to store fresh data: (data) => void
const SystemLogView = forwardRef(function SystemLogView({ source, cachedData, onFetched }, ref) {
  const { t } = useI18n();
  const logContainerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/api/admin/logs/${source}`);
      onFetched?.(d);
    } catch {
      onFetched?.({ available: false, lines: [], reason: t("admin.logs.loadFailed") });
    }
  }, [source, onFetched, t]);

  // Fetch on mount only if we have no cached data yet.
  useEffect(() => {
    if (!cachedData) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Scroll to bottom whenever fresh lines arrive.
  useEffect(() => {
    if (cachedData?.lines?.length > 0 && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [cachedData]);

  useImperativeHandle(ref, () => ({ refresh: load }), [load]);

  // Show LoadingRows only on the very first load (no cached data yet).
  const initialized = cachedData !== null;

  return (
    <div className="space-y-3">
      {!initialized ? <LoadingRows /> : !cachedData?.available ? (
        <EmptyState message={cachedData?.reason || t("admin.logs.unavailable")} />
      ) : cachedData.lines.length === 0 ? (
        <EmptyState message={t("admin.logs.emptyLog")} />
      ) : (
        <div className={"overflow-hidden " + cardCls}>
          <pre ref={logContainerRef} className="app-scroll max-h-[40vh] overflow-auto p-3 text-[10px] leading-relaxed text-slate-600 sm:max-h-[60vh] sm:p-4 sm:text-[11px] dark:text-slate-300">
            {cachedData.lines.join("\n")}
          </pre>
        </div>
      )}
      {cachedData?.source && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {t("admin.logs.source")}: <code className="rounded-sm bg-slate-100 px-1 py-0.5 dark:bg-white/10">{cachedData.source}</code>
        </p>
      )}
    </div>
  );
});

// ─── Tab container ────────────────────────────────────────────────────────────

// Module-level store so cache survives tab navigation (same pattern as useAdminCache).
const _logCache = {};

const LogsTab = forwardRef(function LogsTab({ currentUser, active = true }, ref) {
  const { t } = useI18n();
  const [source, setSource]                 = useState("admin");
  const [availableSources, setAvailableSources] = useState(null); // null = probing

  // Per-source cache: { admin: { logs, total } | null, installer: {...} | null, ... }
  // null = not yet fetched; populated value = last-known data (shown instantly on revisit).
  const [sourceCache, setSourceCache] = useState(() => ({
    admin:     _logCache.admin     ?? null,
    installer: _logCache.installer ?? null,
    service:   _logCache.service   ?? null,
    worker:    _logCache.worker    ?? null,
    nginx:     _logCache.nginx     ?? null,
    sources:   _logCache.sources   ?? null, // sources probe result
  }));

  // Keep module store in sync so data survives unmount/remount.
  const persistCache = useCallback((key, data) => {
    _logCache[key] = data;
    setSourceCache((prev) => ({ ...prev, [key]: data }));
  }, []);

  const viewRef = useRef(null);

  useImperativeHandle(ref, () => ({ refresh: () => viewRef.current?.refresh() }), []);

  // Probe which log sources exist. Uses cached result if available; otherwise
  // fetches once and caches permanently for the session.
  useEffect(() => {
    if (sourceCache.sources !== null) {
      // Restore from cache — re-apply availability and ensure source is valid.
      const available = sourceCache.sources;
      if (!available.has(source)) setSource("admin");
      return;
    }
    api.get("/api/admin/logs/sources")
      .then((data) => {
        const available = new Set(
          Object.entries(data.sources ?? {})
            .filter(([, v]) => v?.available)
            .map(([k]) => k),
        );
        available.add("admin"); // always present
        persistCache("sources", available);
        setAvailableSources(available);
        if (!available.has(source)) setSource("admin");
      })
      .catch(() => {
        const fallback = new Set(ALL_LOG_SOURCES.map((s) => s.id));
        persistCache("sources", fallback);
        setAvailableSources(fallback);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync availableSources state from cache on mount (when cache already populated).
  useEffect(() => {
    if (availableSources === null && sourceCache.sources !== null) {
      setAvailableSources(sourceCache.sources);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceCache.sources]);

  // Stable callbacks per source so child components don't re-render on unrelated cache updates.
  const onAdminFetched   = useCallback((d) => persistCache("admin",     d), [persistCache]);
  const onInstallerFetched = useCallback((d) => persistCache("installer", d), [persistCache]);
  const onServiceFetched = useCallback((d) => persistCache("service",   d), [persistCache]);
  const onWorkerFetched  = useCallback((d) => persistCache("worker",    d), [persistCache]);
  const onNginxFetched   = useCallback((d) => persistCache("nginx",     d), [persistCache]);

  const onFetchedBySource = useMemo(() => ({
    admin:     onAdminFetched,
    installer: onInstallerFetched,
    service:   onServiceFetched,
    worker:    onWorkerFetched,
    nginx:     onNginxFetched,
  }), [onAdminFetched, onInstallerFetched, onServiceFetched, onWorkerFetched, onNginxFetched]);

  // Show all tabs always; disable ones that aren't available in this deployment.
  const visibleSources = ALL_LOG_SOURCES.map((s) => ({
    ...s,
    disabled: availableSources !== null && !availableSources.has(s.id),
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-nowrap gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [touch-action:pan-x_pan-y] sm:gap-1.5 [&::-webkit-scrollbar]:hidden">
        {visibleSources.map(({ id, label, disabled }) => (
          <button key={id} type="button" onClick={() => !disabled && setSource(id)}
            disabled={disabled}
            className={`shrink-0 whitespace-nowrap rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:text-xs ${
              source === id
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
            }`}>
            {t(label)}
          </button>
        ))}
      </div>
      {source === "admin"
        ? <AdminLogView
            ref={viewRef}
            currentUser={currentUser}
            active={active && source === "admin"}
            cachedData={sourceCache.admin}
            onFetched={onAdminFetched}
          />
        : <SystemLogView
            ref={viewRef}
            source={source}
            key={source}
            cachedData={sourceCache[source] ?? null}
            onFetched={onFetchedBySource[source]}
          />
      }
    </div>
  );
});

export default LogsTab;
