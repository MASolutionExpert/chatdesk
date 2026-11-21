import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Activity,
  Ban,
  Bell,
  Chat,
  Database,
  Files,
  Megaphone,
  MemoryStick,
  MessageCircleMore,
  MonitorDot,
  User,
  Users,
  UserPlus,
  Wifi,
} from "../../icons/lucide.js";
import { api, cardCls, fmtBytes, fmtUptime } from "./adminShared.js";
import { SectionHeading } from "./AdminCommon.jsx";
import Tooltip from "../common/Tooltip.jsx";
import { useI18n } from "../../i18n/index.js";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Eases a value toward `target`, starting from 0 on first mount and smoothly
// tweening from the last shown value on subsequent updates (e.g. auto-refresh).
function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (typeof target !== "number" || !Number.isFinite(target))
      return undefined;
    if (prefersReducedMotion()) {
      fromRef.current = target;
      setVal(target);
      return undefined;
    }
    const from = fromRef.current;
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const cur = from + (target - from) * ease(p);
      fromRef.current = cur;
      setVal(cur);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return val;
}

function CountUp({ value }) {
  const numeric = typeof value === "number" && Number.isFinite(value);
  const animated = useCountUp(numeric ? value : NaN);
  if (!numeric) return value ?? "—";
  return Math.round(animated).toLocaleString();
}

const GAUGE_COLORS = {
  emerald: { track: "#d1fae5", fill: "#10b981", dark_track: "#064e3b" },
  orange: { track: "#fed7aa", fill: "#f97316", dark_track: "#431407" },
  rose: { track: "#fecdd3", fill: "#f43f5e", dark_track: "#4c0519" },
};

function SemiCircleGauge({
  pct,
  color = "emerald",
  label,
  sublabel,
  size = 120,
}) {
  const target = Math.max(0, Math.min(100, pct || 0));
  const safe = useCountUp(target);
  const r = 44,
    cx = 60,
    cy = 60;
  const circ = Math.PI * r;
  const offset = circ - (safe / 100) * circ;
  const c = GAUGE_COLORS[color] || GAUGE_COLORS.emerald;
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  const trackColor = isDark ? c.dark_track : c.track;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg
        viewBox="0 0 120 68"
        width={size}
        height={size * 0.6}
        style={{ overflow: "visible" }}
        aria-hidden="true"
      >
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={trackColor}
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={c.fill}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circ}`}
          strokeDashoffset={`${offset}`}
        />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="16"
          fontWeight="700"
          fill={c.fill}
          fontFamily="inherit"
        >
          {safe.toFixed(0)}%
        </text>
      </svg>
      {label && (
        <p className="mt-1 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </p>
      )}
      {sublabel && (
        <p className="text-center text-[10px] text-slate-400 dark:text-slate-500">
          {sublabel}
        </p>
      )}
    </div>
  );
}

const DashboardTab = forwardRef(function DashboardTab({ stats, onStatsChange }, ref) {
  const { t } = useI18n();
  const [sys, setSys] = useState(null);
  // Parent owns `/api/admin/stats` polling; keep a stable ref so manual refresh
  // can still bump stats without putting an unstable callback in effect deps.
  const onStatsChangeRef = useRef(onStatsChange);
  useEffect(() => {
    onStatsChangeRef.current = onStatsChange;
  }, [onStatsChange]);

  const loadSys = useCallback(async () => {
    try {
      const d = await api.get("/api/admin/system");
      setSys(d);
    } catch {}
  }, []);

  // Poll system gauges only. Stats are refreshed by AdminPanel's interval —
  // calling onStatsChange here previously created a fetch/render loop whenever
  // the parent passed a new inline callback.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      loadSys();
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadSys]);

  useImperativeHandle(ref, () => ({
    refresh: () => {
      loadSys();
      onStatsChangeRef.current?.();
    },
  }), [loadSys]);

  // `sys` retains the last successfully fetched data; it is never reset to null
  // after the first load, so a refresh in-flight keeps showing the prior values.
  const displaySys = sys;

  const sysPct = displaySys
    ? Math.round((displaySys.memory.systemUsed / displaySys.memory.systemTotal) * 100)
    : 0;
  const heapPct = displaySys
    ? Math.round((displaySys.memory.heapUsed / displaySys.memory.heapTotal) * 100)
    : 0;
  const load1 = displaySys?.loadAvg?.[0] ?? null;
  const loadPct = displaySys
    ? Math.round(Math.min(100, (load1 / (displaySys.cpuCount || 1)) * 100))
    : 0;
  const diskTotal = displaySys?.storage?.diskTotalBytes ?? 0;
  const diskUsed = displaySys?.storage?.diskUsedBytes ?? 0;
  const diskPct = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
  const uploadsSize = displaySys?.storage?.uploadsSizeBytes ?? 0;

  const gaugeColor = (pct) =>
    pct > 85 ? "rose" : pct > 65 ? "orange" : "emerald";

  const chatBreakdown = stats
    ? t("admin.dashboard.chatBreakdown", { groups: stats.groupChats ?? 0, channels: stats.channelChats ?? 0 })
    : undefined;

  const statCards = [
    {
      label: t("admin.dashboard.totalUsers"),
      value: stats?.totalUsers,
      icon: User,
      accent: "emerald",
    },
    {
      label: t("admin.dashboard.onlineUsers"),
      value: stats?.onlineUsers,
      icon: Wifi,
      accent: "emerald",
      hint: t("admin.dashboard.onlineUsersHint"),
    },
    {
      label: t("admin.dashboard.newUsers7d"),
      value: stats?.newUsers7d,
      icon: UserPlus,
      accent: "emerald",
      hint: t("admin.dashboard.newUsers7dHint"),
    },
    { label: t("admin.dashboard.banned"), value: stats?.bannedUsers, icon: Ban, accent: "rose" },
    {
      label: t("admin.dashboard.totalChats"),
      value: stats?.totalChats,
      icon: Chat,
      accent: "emerald",
      hint: chatBreakdown,
    },
    {
      label: t("admin.dashboard.totalGroups"),
      value: stats?.groupChats,
      icon: Users,
      accent: "emerald",
      hint: t("admin.dashboard.totalGroupsHint"),
    },
    {
      label: t("admin.dashboard.totalChannels"),
      value: stats?.channelChats,
      icon: Megaphone,
      accent: "emerald",
      hint: t("admin.dashboard.totalChannelsHint"),
    },
    {
      label: t("admin.dashboard.totalMessages"),
      value: stats?.totalMessages,
      icon: MessageCircleMore,
      accent: "emerald",
    },
    {
      label: t("admin.dashboard.messages24h"),
      value: stats?.messagesLast24h,
      icon: MessageCircleMore,
      accent: "emerald",
      hint: t("admin.dashboard.messages24hHint"),
    },
    {
      label: t("admin.dashboard.uploadedFiles"),
      value: stats?.totalFiles,
      icon: Files,
      accent: "emerald",
      hint: t("admin.dashboard.uploadedFilesHint"),
    },
    {
      label: t("admin.dashboard.pushDevices"),
      value: stats?.pushSubscriptions,
      icon: Bell,
      accent: "emerald",
      hint: t("admin.dashboard.pushDevicesHint"),
    },
    {
      label: t("admin.dashboard.activeSessions"),
      value: stats?.totalSessions,
      icon: MonitorDot,
      accent: "emerald",
    },
  ];

  const infoCards = [
    {
      label: t("admin.dashboard.databaseSize"),
      value: displaySys ? fmtBytes(uploadsSize) : "—",
      icon: Database,
      hint: t("admin.dashboard.databaseSizeHint"),
    },
    {
      label: t("admin.dashboard.processRss"),
      value: displaySys ? fmtBytes(displaySys.memory.rss) : "—",
      icon: MemoryStick,
      hint: t("admin.dashboard.processRssHint"),
    },
    {
      label: t("admin.dashboard.uptime"),
      value: displaySys ? fmtUptime(displaySys.uptime) : "—",
      icon: Activity,
      accent: true,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Resource gauges */}
      <div>
        <SectionHeading>{t("admin.dashboard.resources")}</SectionHeading>
        <div className={cardCls + " p-4"}>
          <div className="flex flex-wrap items-start justify-around gap-2">
            <SemiCircleGauge
              pct={loadPct}
              color={gaugeColor(loadPct)}
              label={t("admin.dashboard.cpuLoad")}
              sublabel={displaySys ? t("admin.dashboard.cpuSublabel", { avg: load1?.toFixed(2), cores: displaySys.cpuCount }) : "—"}
            />
            <SemiCircleGauge
              pct={heapPct}
              color={gaugeColor(heapPct)}
              label={t("admin.dashboard.appMemory")}
              sublabel={displaySys ? `${fmtBytes(displaySys.memory.heapUsed)} / ${fmtBytes(displaySys.memory.heapTotal)}` : "—"}
            />
            <SemiCircleGauge
              pct={sysPct}
              color={gaugeColor(sysPct)}
              label={t("admin.dashboard.systemMemory")}
              sublabel={displaySys ? `${fmtBytes(displaySys.memory.systemUsed)} / ${fmtBytes(displaySys.memory.systemTotal)}` : "—"}
            />
            <SemiCircleGauge
              pct={diskPct}
              color={gaugeColor(diskPct)}
              label={t("admin.dashboard.diskStorage")}
              sublabel={displaySys
                ? (diskTotal > 0 ? `${fmtBytes(diskUsed)} / ${fmtBytes(diskTotal)}` : t("admin.dashboard.diskUnavailable"))
                : "—"}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {infoCards.map(({ label, value, icon: Icon, accent, hint }) => (
            <Tooltip key={label} label={hint} placement="bottom" as="div" className="w-full">
              <div className={cardCls + " w-full px-4 py-3"}>
                <div className="mb-1 flex items-center gap-1.5">
                  <Icon size={11} className="shrink-0 text-emerald-500" />
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
                    {label}
                  </span>
                </div>
                <span
                  className={`text-base font-bold ${accent ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-200"}`}
                >
                  {value}
                </span>
              </div>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Overview stat cards */}
      <div>
        <SectionHeading>{t("admin.dashboard.overview")}</SectionHeading>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {statCards.map(({ label, value, icon: Icon, accent, hint }) => (
            <Tooltip key={label} label={hint} placement="bottom" as="div" className="w-full">
              <div className={cardCls + " w-full px-4 py-3"}>
                <div className="flex items-center gap-1.5">
                  <Icon
                    size={12}
                    className={
                      accent === "rose" ? "text-rose-400" : "text-emerald-500"
                    }
                  />
                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
                    {label}
                  </p>
                </div>
                <p
                  className={`mt-1.5 text-2xl font-bold ${accent === "rose" ? "text-rose-500 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-300"}`}
                >
                  <CountUp value={value} />
                </p>
              </div>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
});

export default DashboardTab;
