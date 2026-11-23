import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CircleCheck,
  Clock12,
  Filter,
  Gauge,
  Headset,
  LifeBuoy,
  LoaderCircle,
  MessageCircleMore,
  Refresh,
  TriangleAlert,
  Users,
} from "../../icons/lucide.js";
import { apiFetch } from "../../api/chatApi.js";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  inputSmCls,
} from "./adminShared.js";
import { useI18n } from "../../i18n/index.js";
import { hasPersian } from "../../utils/fontUtils.js";

/**
 * DepartmentReportView — the dedicated per-department performance page the
 * admin reaches by clicking a department name in the helpdesk summary.
 *
 * Shows the department's operators, an at-a-glance performance summary, and
 * a precise time-filtered report (date range) backed by
 * GET /api/admin/support/report?departmentId=&from=&to= — every number is
 * computed server-side.
 */
const DepartmentReportView = function DepartmentReportView({ departmentId, onBack }) {
  const { t } = useI18n();

  const dayStr = (offsetDays = 0) => {
    const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const [from, setFrom] = useState(dayStr(-29));
  const [to, setTo] = useState(dayStr(0));
  const [applied, setApplied] = useState({ from: dayStr(-29), to: dayStr(0) });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchReport = useCallback(async (range) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("departmentId", String(departmentId));
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      const res = await apiFetch(`/api/admin/support/report?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("admin.helpdesk.report.loadError"));
        setReport(null);
        return;
      }
      const data = await res.json();
      setReport(data);
    } catch {
      setError(t("admin.helpdesk.report.loadError"));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [departmentId, t]);

  useEffect(() => {
    if (departmentId) void fetchReport(applied);
  }, [departmentId, applied, fetchReport]);

  function applyPreset(days) {
    const next = days === null ? { from: "", to: "" } : { from: dayStr(-(days - 1)), to: dayStr(0) };
    setFrom(next.from);
    setTo(next.to);
    setApplied(next);
  }

  function applyFilter(e) {
    e?.preventDefault();
    setApplied({ from: from.trim(), to: to.trim() });
  }

  const dept = useMemo(() => report?.departments?.[0] ?? null, [report]);
  const totals = dept?.totals ?? null;
  const nameHasPersian = hasPersian(dept?.name || "");

  return (
    <div className="space-y-6">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div className={cardCls + " p-4"}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className={btnSecondary}
            aria-label={t("admin.helpdesk.report.back")}
          >
            <ArrowLeft size={14} />
            {t("admin.helpdesk.report.back")}
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 truncate text-sm font-bold text-slate-800 dark:text-slate-100" dir="auto">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: dept?.color || "#10b981" }}
              />
              <span className={nameHasPersian ? "font-fa" : ""}>{dept?.name ?? "…"}</span>
              {dept && !dept.active ? (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {t("admin.helpdesk.inactive")}
                </span>
              ) : null}
            </h3>
            {totals ? (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {t("admin.helpdesk.report.rangeLabel", {
                  from: applied.from || t("admin.helpdesk.report.rangeStart"),
                  to: applied.to || t("admin.helpdesk.report.rangeNow"),
                })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void fetchReport(applied)}
            className={btnSecondary}
            aria-label={t("admin.helpdesk.refresh")}
          >
            <Refresh size={14} />
          </button>
        </div>
      </div>

      {/* ─── Time filter ────────────────────────────────────────────────────── */}
      <div className={cardCls + " p-4"}>
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Filter size={13} className="text-emerald-500" />
          {t("admin.helpdesk.report.filterTitle")}
        </h4>
        <form onSubmit={applyFilter} className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[130px] flex-1 sm:max-w-[180px]">
            <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300" htmlFor="report-from">
              {t("admin.helpdesk.report.rangeFrom")}
            </label>
            <input
              id="report-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className={inputSmCls}
            />
          </div>
          <div className="min-w-[130px] flex-1 sm:max-w-[180px]">
            <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300" htmlFor="report-to">
              {t("admin.helpdesk.report.rangeTo")}
            </label>
            <input
              id="report-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className={inputSmCls}
            />
          </div>
          <button type="submit" className={btnPrimary} disabled={loading}>
            <Filter size={13} className="icon-anim-pop" />
            {t("admin.helpdesk.report.apply")}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            { label: t("admin.helpdesk.report.presetToday"), days: 1 },
            { label: t("admin.helpdesk.report.preset7d"), days: 7 },
            { label: t("admin.helpdesk.report.preset30d"), days: 30 },
            { label: t("admin.helpdesk.report.presetAll"), days: null },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset.days)}
              className={
                "rounded-full px-3 py-1 text-[11px] font-semibold transition " +
                (applied.from === (preset.days === null ? "" : dayStr(-(preset.days - 1))) &&
                 applied.to === (preset.days === null ? "" : dayStr(0))
                  ? "bg-emerald-500 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700")
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/40 dark:text-rose-200">
          <TriangleAlert size={14} />
          {error}
        </p>
      ) : null}

      {loading && !report ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500 dark:text-slate-400">
          <LoaderCircle size={16} className="animate-spin" />
          {t("admin.helpdesk.report.loading")}
        </div>
      ) : null}

      {/* ─── Totals ─────────────────────────────────────────────────────────── */}
      {dept && totals ? (
        <>
          <section className={cardCls + " p-4"}>
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t("admin.helpdesk.report.summaryTitle")}
            </h4>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TotalCard icon={<MessageCircleMore size={14} />} label={t("admin.helpdesk.metricChats")} value={totals.conversations} />
              <TotalCard icon={<CircleCheck size={14} />} label={t("admin.helpdesk.report.metricAnswered")} value={totals.answered} tone="emerald" />
              <TotalCard icon={<TriangleAlert size={14} />} label={t("admin.helpdesk.report.metricUnanswered")} value={totals.unanswered} tone={totals.unanswered > 0 ? "amber" : "slate"} />
              <TotalCard icon={<MessageCircleMore size={14} />} label={t("admin.helpdesk.metricMsgs")} value={totals.messages} />
              <TotalCard icon={<LifeBuoy size={14} />} label={t("admin.helpdesk.report.metricTicketsOpened")} value={totals.ticketsOpened} />
              <TotalCard icon={<CircleCheck size={14} />} label={t("admin.helpdesk.report.metricTicketsClosed")} value={totals.ticketsClosed} />
              <TotalCard icon={<Clock12 size={14} />} label={t("admin.helpdesk.report.metricOpenTickets")} value={totals.openTickets} tone={totals.openTickets > 0 ? "amber" : "slate"} />
              <TotalCard
                icon={<Gauge size={14} />}
                label={t("admin.helpdesk.report.metricAvgResponse")}
                value={totals.avgFirstResponseSeconds === null ? "—" : t("admin.helpdesk.report.seconds", { n: totals.avgFirstResponseSeconds })}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
              <TotalCard
                icon={<Headset size={14} />}
                label={t("admin.helpdesk.report.metricStaffMsgs")}
                value={totals.staffMessages}
              />
              <TotalCard
                icon={<Users size={14} />}
                label={t("admin.helpdesk.report.metricCustomerMsgs")}
                value={totals.customerMessages}
              />
            </div>
          </section>

          {/* ─── Operators ──────────────────────────────────────────────────── */}
          <section className={cardCls + " p-4"}>
            <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Headset size={13} className="text-sky-500" />
              {t("admin.helpdesk.report.operators")}
            </h4>
            {dept.operators.length ? (
              <div className="app-scroll mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
                {dept.operators.map((op) => (
                  <div
                    key={op.id}
                    className="rounded-2xl border border-slate-100 bg-white/70 p-3 dark:border-white/5 dark:bg-slate-900/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100" dir="auto">
                        <Headset size={13} className="shrink-0 text-sky-500" />
                        <span className="truncate">{op.nickname || op.username}</span>
                        <span className="hidden text-[10px] font-normal text-slate-400 sm:inline">@{op.username}</span>
                      </p>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        {op.role}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                      <OpMetric label={t("admin.helpdesk.report.opAssigned")} value={op.assigned} />
                      <OpMetric label={t("admin.helpdesk.report.metricAnswered")} value={op.answered} tone="emerald" />
                      <OpMetric label={t("admin.helpdesk.report.metricUnanswered")} value={op.unanswered} tone={op.unanswered > 0 ? "amber" : "slate"} />
                      <OpMetric label={t("admin.helpdesk.metricMsgs")} value={op.messagesSent} />
                      <OpMetric label={t("admin.helpdesk.report.metricTicketsOpened")} value={op.ticketsOpened} />
                      <OpMetric label={t("admin.helpdesk.report.metricTicketsClosed")} value={op.ticketsClosed} />
                      <OpMetric
                        label={t("admin.helpdesk.report.metricAvgResponse")}
                        value={op.avgFirstResponseSeconds === null ? "—" : t("admin.helpdesk.report.seconds", { n: op.avgFirstResponseSeconds })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-amber-300 px-3 py-4 text-center text-xs font-semibold text-amber-600 dark:border-amber-500/40 dark:text-amber-300">
                {t("admin.helpdesk.noOperators")}
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
};

function TotalCard({ icon, label, value, tone = "slate" }) {
  const toneCls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        : "bg-slate-50 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300";
  return (
    <div className={"rounded-2xl px-3 py-2.5 " + toneCls}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1.5 text-lg font-bold leading-none">{value}</p>
    </div>
  );
}

function OpMetric({ label, value, tone = "slate" }) {
  const toneCls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <div className={"rounded-xl px-2 py-1.5 text-center " + toneCls}>
      <p className="text-sm font-bold leading-none">{value}</p>
      <p className="mt-1 truncate text-[10px] font-medium opacity-80" title={label}>{label}</p>
    </div>
  );
}

export default DepartmentReportView;
