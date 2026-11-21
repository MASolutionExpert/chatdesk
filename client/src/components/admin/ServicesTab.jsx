import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Clapper,
  Database,
  KeyRound,
  LoaderCircle,
  PackageOpen,
  PhoneCall,
} from "../../icons/lucide.js";
import { TelegramIcon } from "../../icons/BrandIcons.jsx";
import Tooltip from "../common/Tooltip.jsx";
import { api } from "./adminShared.js";
import { SectionHeading } from "./AdminCommon.jsx";
import RemoteChannelSetupModal from "./RemoteChannelSetupModal.jsx";
import { useI18n } from "../../i18n/index.js";

// ─── Status badge — mirrors ActionsTab ───────────────────────────────────────

function StatusBadge({ status }) {
  const { t } = useI18n();
  if (!status) return null;
  // "env" mirrors the Settings tab EnvLockBadge for env-managed values.
  if (status.type === "env") {
    return (
      <Tooltip label={t("admin.services.envManaged")}>
        <span
          tabIndex={0}
          className="inline-flex cursor-help items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-400"
        >
          <KeyRound size={9} /> {t("admin.common.envChip")}
        </span>
      </Tooltip>
    );
  }
  const { type, label } = status;
  const cls =
    type === "error"
      ? "text-rose-600 dark:text-rose-300"
      : "text-emerald-600 dark:text-emerald-300";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${cls}`}>
      {type === "busy" ? (
        <LoaderCircle size={13} className="animate-spin" />
      ) : type === "error" ? (
        <AlertCircle size={13} />
      ) : (
        <Check size={13} />
      )}
      {label}
    </span>
  );
}

// ─── Service row — mirrors ActionsTab ActionRow ──────────────────────────────

function ServiceRow({
  icon: Icon,
  iconAnim = "icon-anim-sway",
  label,
  description,
  onClick,
  disabled = false,
  status = null,
}) {
  const busy = status?.type === "busy";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="flex h-full w-full flex-col items-start gap-2 rounded-2xl border border-emerald-200/70 bg-white/90 p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-slate-950/50 dark:hover:bg-emerald-500/5"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400">
          <Icon size={22} className={iconAnim} />
        </div>
        {status && <div className="shrink-0 pt-1"><StatusBadge status={status} /></div>}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {label}
        </p>
        {description && (
          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            {description}
          </p>
        )}
      </div>
    </button>
  );
}

const ServicesTab = forwardRef(function ServicesTab(
  { data, onMutated },
  ref,
) {
  const { t } = useI18n();
  const [rowStatus, setRowStatus] = useState({});
  const [setupOpen, setSetupOpen] = useState(false);
  const statusTimers = useRef({});

  const flashStatus = (key, type, label, ms = 3000) => {
    if (statusTimers.current[key]) clearTimeout(statusTimers.current[key]);
    setRowStatus((prev) => ({ ...prev, [key]: { type, label } }));
    if (type !== "busy") {
      statusTimers.current[key] = setTimeout(() => {
        setRowStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, ms);
    }
  };

  useImperativeHandle(ref, () => ({
    refresh: () => api.get("/api/admin/services").then(() => {}).catch(() => {}),
  }), []);

  const mediaWorker = data?.mediaWorker || null;
  const remoteChannel = data?.remoteChannel || null;
  const storage = data?.storage || null;
  const database = data?.database || null;
  const turn = data?.turn || null;

  const workerDescription = mediaWorker?.configured
    ? mediaWorker.reachable
      ? (mediaWorker.latencyMs != null
        ? t("admin.services.workerReachableMs", { ms: mediaWorker.latencyMs })
        : t("admin.services.workerReachable"))
      : t("admin.services.configuredUnreachable")
    : t("admin.services.workerLocalFallback");

  const remoteFeatureOn = Boolean(remoteChannel?.enabled);
  const remoteLinked = Boolean(remoteChannel?.telegramConfigured);
  const remoteEnvManaged = Boolean(remoteChannel?.telegramManagedByEnv);
  const remoteDescription = !remoteFeatureOn
    ? t("admin.services.remoteDisabled")
    : remoteEnvManaged
      ? t("admin.services.remoteEnvSet")
      : remoteLinked
        ? (remoteChannel.telegramConnected
          ? t("admin.services.remoteLinkedConnected")
          : t("admin.services.remoteLinked"))
        : t("admin.services.remoteNotLinked");

  const handleWorkerCheck = async () => {
    flashStatus("worker", "busy", t("admin.services.checking"));
    try {
      const payload = await api.get("/api/admin/services");
      const reachable = payload?.mediaWorker?.reachable;
      const configured = payload?.mediaWorker?.configured;
      if (reachable || !configured) flashStatus("worker", "success", t("admin.services.active"));
      else flashStatus("worker", "error", t("admin.services.inactive"));
    } catch {
      flashStatus("worker", "error", t("admin.services.checkFailed"));
    }
  };

  const storageReachable = storage?.reachable;
  const storageDescription =
    (storageReachable && storage?.latencyMs != null
      ? t("admin.services.storageDescMs", { driver: storage?.driver || "local", ms: storage.latencyMs })
      : t("admin.services.storageDesc", { driver: storage?.driver || "local" }));
  const handleStorageCheck = async () => {
    flashStatus("storage", "busy", t("admin.services.checking"));
    try {
      const payload = await api.get("/api/admin/services");
      if (payload?.storage?.reachable === false) {
        flashStatus("storage", "error", t("admin.services.unreachable"));
      } else {
        flashStatus("storage", "success", t("admin.services.active"));
      }
    } catch {
      flashStatus("storage", "error", t("admin.services.checkFailed"));
    }
  };

  const isPostgres = database?.client === "postgres";
  const databaseReachable = database?.reachable;
  const isDatabaseConfigured = database?.configured !== false;
  const databaseDescription = !isDatabaseConfigured
    ? t("admin.services.dbDisabled")
    : isPostgres
      ? databaseReachable === false
        ? t("admin.services.pgUnreachable")
        : (databaseReachable && database?.latencyMs != null
          ? t("admin.services.pgDescMs", { ms: database.latencyMs })
          : t("admin.services.pgDesc"))
      : databaseReachable === false
        ? t("admin.services.sqliteUnreachable")
        : (databaseReachable && database?.latencyMs != null
          ? t("admin.services.sqliteDescMs", { ms: database.latencyMs })
          : t("admin.services.sqliteDesc"));
  const handleDatabaseCheck = async () => {
    flashStatus("database", "busy", t("admin.services.checking"));
    try {
      const payload = await api.get("/api/admin/services");
      if (payload?.database?.reachable === false) {
        flashStatus("database", "error", t("admin.services.unreachable"));
      } else {
        flashStatus("database", "success", t("admin.services.active"));
      }
    } catch {
      flashStatus("database", "error", t("admin.services.checkFailed"));
    }
  };

  const isTurnConfigured = Boolean(turn?.configured);
  const turnReachable = turn?.reachable;
  const turnDescription = !isTurnConfigured
    ? t("admin.services.turnStunOnly")
    : turnReachable === false
      ? t("admin.services.configuredUnreachable")
      : (turn?.managed
        ? (turnReachable && turn?.latencyMs != null
          ? t("admin.services.turnCloudflareMs", { ms: turn.latencyMs })
          : t("admin.services.turnCloudflare"))
        : (turnReachable && turn?.latencyMs != null
          ? t("admin.services.turnRelayMs", { ms: turn.latencyMs })
          : t("admin.services.turnRelay")));

  const handleTurnCheck = async () => {
    flashStatus("turn", "busy", t("admin.services.checking"));
    try {
      const payload = await api.get("/api/admin/services");
      if (payload?.turn?.reachable === false) {
        flashStatus("turn", "error", t("admin.services.unreachable"));
      } else {
        flashStatus("turn", "success", t("admin.services.active"));
      }
    } catch {
      flashStatus("turn", "error", t("admin.services.checkFailed"));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionHeading>{t("admin.tabs.services")}</SectionHeading>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ServiceRow
            icon={Clapper}
            iconAnim="icon-anim-beat"
            label={t("admin.services.mediaWorker")}
            description={workerDescription}
            onClick={handleWorkerCheck}
            status={
              rowStatus.worker ||
              (mediaWorker
                ? mediaWorker.reachable || !mediaWorker.configured
                  ? { type: "success", label: t("admin.services.active") }
                  : { type: "error", label: t("admin.services.inactive") }
                : null)
            }
          />
          <ServiceRow
            icon={TelegramIcon}
            iconAnim="icon-anim-sway"
            label={t("admin.services.telegramConnection")}
            description={remoteDescription}
            onClick={() => setSetupOpen(true)}
            disabled={!remoteFeatureOn || remoteEnvManaged}
            status={
              !remoteFeatureOn
                ? { type: "error", label: t("admin.common.disabled") }
                : remoteEnvManaged
                  ? { type: "env" }
                  : rowStatus.remote ||
                    (remoteChannel
                      ? remoteLinked
                        ? { type: "success", label: t("admin.services.connected") }
                        : { type: "error", label: t("admin.services.notConfigured") }
                      : null)
            }
          />
          <ServiceRow
            icon={PackageOpen}
            iconAnim="icon-anim-drop"
            label={t("admin.services.storage")}
            description={storageDescription}
            onClick={handleStorageCheck}
            status={
              rowStatus.storage ||
              (storage
                ? storageReachable === false
                  ? { type: "error", label: t("admin.services.unreachable") }
                  : { type: "success", label: t("admin.services.active") }
                : null)
            }
          />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ServiceRow
            icon={Database}
            iconAnim="icon-anim-drop"
            label={t("admin.services.database")}
            description={databaseDescription}
            onClick={handleDatabaseCheck}
            disabled={!isDatabaseConfigured}
            status={
              !isDatabaseConfigured
                ? { type: "error", label: t("admin.common.disabled") }
                : rowStatus.database ||
                  (database
                    ? databaseReachable === false
                      ? { type: "error", label: t("admin.services.unreachable") }
                      : { type: "success", label: t("admin.services.active") }
                    : null)
            }
          />
          <ServiceRow
            icon={PhoneCall}
            iconAnim="icon-anim-sway"
            label={t("admin.services.turnServer")}
            description={turnDescription}
            onClick={handleTurnCheck}
            disabled={!isTurnConfigured}
            status={
              !isTurnConfigured
                ? { type: "error", label: t("admin.common.disabled") }
                : rowStatus.turn ||
                  (turn
                    ? turnReachable === false
                      ? { type: "error", label: t("admin.services.unreachable") }
                      : { type: "success", label: t("admin.services.active") }
                    : null)
            }
          />
        </div>
      </div>
      <RemoteChannelSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onChanged={() => onMutated?.()}
      />
    </div>
  );
});

export default ServicesTab;
