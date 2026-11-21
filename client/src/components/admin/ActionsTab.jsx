import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { apiFetch } from "../../api/chatApi.js";
import { fetchAppInfo, checkAppVersion } from "../../api/appMetaApi.js";
import {
  AlertCircle,
  Brush,
  Check,
  HardDriveDownload,
  HardDriveUpload,
  LoaderCircle,
  MessageCircleX,
  Power,
  Refresh,
  Rotate,
  Trash,
} from "../../icons/lucide.js";
import { api } from "./adminShared.js";
import { TypedConfirmModal, SectionHeading } from "./AdminCommon.jsx";
import ConfirmModal from "../modals/ConfirmModal.jsx";
import { useI18n } from "../../i18n/index.js";

// ─── Status badge — shown on the right side of an action row ────────────────

function StatusBadge({ status }) {
  if (!status) return null;
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

// ─── Action row — the row itself is the button ────────────────────────────────

function ActionRow({
  icon: Icon,
  iconAnim = "icon-anim-sway",
  label,
  description,
  onClick,
  disabled = false,
  status = null,
  danger = false,
}) {
  const busy = status?.type === "busy";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`flex h-full w-full flex-col items-start gap-2 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        danger
          ? "border-rose-200/70 bg-rose-50/40 hover:border-rose-300 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/4 dark:hover:bg-rose-500/10"
          : "border-emerald-200/70 bg-white/90 hover:border-emerald-300 hover:bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-slate-950/50 dark:hover:bg-emerald-500/5"
      }`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center ${
            danger
              ? "text-rose-500 dark:text-rose-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          <Icon size={22} className={iconAnim} />
        </div>
        {status && <div className="shrink-0 pt-1"><StatusBadge status={status} /></div>}
      </div>
      <div className="min-w-0">
        <p
          className={`text-sm font-semibold ${
            danger
              ? "text-rose-700 dark:text-rose-300"
              : "text-slate-700 dark:text-slate-200"
          }`}
        >
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

// ─── Check for updates row — has its own dynamic status trailing badge ───────

function CheckUpdateRow({ appInfo }) {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const resetRef = useRef(null);
  const versionLabel = String(appInfo?.version || t("admin.actions.unknown")).trim() || t("admin.actions.unknown");

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const scheduleReset = () => {
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => setStatus(null), 3500);
  };

  const check = async () => {
    if (resetRef.current) {
      clearTimeout(resetRef.current);
      resetRef.current = null;
    }
    setStatus({ type: "busy", label: t("admin.services.checking") });
    try {
      const payload = await checkAppVersion(appInfo);
      const s = payload?.status || "up-to-date";
      setStatus(
        s === "error"
          ? { type: "error", label: t("admin.services.checkFailed") }
          : s === "update-available"
            ? { type: "success", label: t("admin.actions.updateAvailable") }
            : { type: "success", label: t("admin.actions.upToDate") },
      );
    } catch {
      setStatus({ type: "error", label: t("admin.services.checkFailed") });
    }
    scheduleReset();
  };

  return (
    <ActionRow
      icon={Refresh}
      iconAnim="icon-anim-spin-full"
      label={t("admin.actions.checkUpdates")}
      description={t("admin.actions.currentVersion", { version: versionLabel })}
      onClick={check}
      status={status}
    />
  );
}

const ActionsTab = forwardRef(function ActionsTab({ serviceStatus }, ref) {
  const { t } = useI18n();
  const [appInfo, setAppInfo] = useState(null);
  const [maintenanceInfo, setMaintenanceInfo] = useState({
    engine: "sqlite",
    backupExtension: ".db",
    restoreAccept: ".db,application/x-sqlite3,application/vnd.sqlite3",
    deleteAvailable: false,
    offlineRestoreRequired: false,
    offlineDeleteRequired: false,
  });
  const [rowStatus, setRowStatus] = useState({});
  const statusTimers = useRef({});
  const serviceAvailable = serviceStatus ? Boolean(serviceStatus.available) : null;

  const [pendingFile, setPendingFile] = useState(null);
  const [serviceAction, setServiceAction] = useState(null);
  const [danger, setDanger] = useState(null);
  const [vacuumConfirmOpen, setVacuumConfirmOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(
    () => () => {
      Object.values(statusTimers.current).forEach((t) => clearTimeout(t));
    },
    [],
  );

  // Set a transient status badge on a row. Non-"busy" statuses auto-clear.
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

  const loadAppInfo = useCallback(() => {
    fetchAppInfo()
      .then((r) => r.json())
      .then((d) => setAppInfo(d))
      .catch(() => {});
  }, []);

  const loadMaintenanceInfo = useCallback(() => {
    api.get("/api/admin/maintenance/info")
      .then((info) => setMaintenanceInfo((current) => ({ ...current, ...info })))
      .catch(() => {});
  }, []);

  useEffect(() => { loadAppInfo(); loadMaintenanceInfo(); }, [loadAppInfo, loadMaintenanceInfo]);

  useImperativeHandle(ref, () => ({ refresh: () => { loadAppInfo(); loadMaintenanceInfo(); } }), [loadAppInfo, loadMaintenanceInfo]);

  const confirmVacuum = async () => {
    flashStatus("vacuum", "busy", t("admin.actions.vacuuming"));
    try {
      const r = await api.post("/api/admin/maintenance/vacuum", {});
      flashStatus("vacuum", r.ok ? "success" : "error", r.ok ? t("admin.actions.vacuumed") : t("admin.actions.failed"));
    } catch {
      flashStatus("vacuum", "error", t("admin.actions.failed"));
    } finally {
      setVacuumConfirmOpen(false);
    }
  };

  const downloadDb = async () => {
    flashStatus("backup", "busy", t("admin.actions.downloading"));
    try {
      const res = await apiFetch("/api/admin/maintenance/download-db");
      if (!res.ok) {
        flashStatus("backup", "error", t("admin.actions.failed"));
        return;
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition");
      let filename = "chatdesk-backup.db";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flashStatus("backup", "success", t("admin.actions.saved"));
    } catch {
      flashStatus("backup", "error", t("admin.actions.failed"));
    }
  };

  const onFilePicked = (e) => {
    const f = e.target.files?.[0] || null;
    e.target.value = "";
    if (f) setPendingFile(f);
  };

  const confirmRestore = async () => {
    if (!pendingFile) return;
    flashStatus("restore", "busy", t("admin.actions.restoring"));
    try {
      const form = new FormData();
      form.append("database", pendingFile);
      const r = await apiFetch("/api/admin/maintenance/restore", {
        method: "POST",
        body: form,
      });
      flashStatus("restore", r.ok ? "success" : "error", r.ok ? t("admin.actions.restored") : t("admin.actions.failed"));
    } catch {
      flashStatus("restore", "error", t("admin.actions.failed"));
    } finally {
      setPendingFile(null);
    }
  };

  const confirmServiceAction = async () => {
    const action = serviceAction;
    if (!action) return;
    const key = action === "restart" ? "restart" : "stop";
    flashStatus(key, "busy", action === "restart" ? t("admin.actions.restartingBusy") : t("admin.actions.stoppingBusy"));
    try {
      await api.post(`/api/admin/service/${action}`, {});
      flashStatus(
        key,
        "success",
        action === "restart" ? t("admin.actions.restarting") : t("admin.actions.stopped"),
        6000,
      );
    } catch {
      flashStatus(key, "error", t("admin.actions.failed"));
    } finally {
      setServiceAction(null);
    }
  };

  const confirmDanger = async () => {
    if (!danger) return;
    flashStatus(danger.key, "busy", danger.busyLabel);
    try {
      const r = await api.post(danger.endpoint, { confirm: danger.phrase });
      flashStatus(danger.key, r.ok ? "success" : "error", r.ok ? danger.doneLabel : t("admin.actions.failed"));
    } catch {
      flashStatus(danger.key, "error", t("admin.actions.failed"));
    } finally {
      setDanger(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* System */}
      <div>
        <SectionHeading>{t("admin.actions.system")}</SectionHeading>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <CheckUpdateRow appInfo={appInfo} />
          <ActionRow
            icon={Rotate}
            iconAnim="icon-anim-spin-full"
            label={t("admin.actions.restartService")}
            description={
              serviceAvailable === false
                ? t("admin.actions.envUnavailable")
                : t("admin.actions.restartDesc")
            }
            onClick={() => setServiceAction("restart")}
            status={rowStatus.restart}
            disabled={!serviceAvailable}
          />
          <ActionRow
            icon={Power}
            iconAnim="icon-anim-beat"
            label={t("admin.actions.stopService")}
            description={
              serviceAvailable === false
                ? t("admin.actions.envUnavailable")
                : t("admin.actions.stopDesc")
            }
            onClick={() => setServiceAction("stop")}
            status={rowStatus.stop}
            disabled={!serviceAvailable}
            danger
          />
        </div>
      </div>

      {/* Database */}
      <div>
        <SectionHeading>{t("admin.actions.dbMaintenance")}</SectionHeading>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ActionRow
            icon={HardDriveDownload}
            iconAnim="icon-anim-drop"
            label={t("admin.actions.backupDb")}
            description={maintenanceInfo.engine === "postgres" ? t("admin.actions.backupDescPg") : t("admin.actions.backupDesc")}
            onClick={downloadDb}
            status={rowStatus.backup}
          />
          <ActionRow
            icon={HardDriveUpload}
            iconAnim="icon-anim-lift"
            label={t("admin.actions.restoreDb")}
            description={maintenanceInfo.offlineRestoreRequired ? t("admin.actions.restoreDescPg") : t("admin.actions.restoreDesc")}
            onClick={() => fileRef.current?.click()}
            status={rowStatus.restore}
            disabled={maintenanceInfo.offlineRestoreRequired}
          />
          <input
            ref={fileRef}
            type="file"
            accept={maintenanceInfo.restoreAccept}
            onChange={onFilePicked}
            className="hidden"
          />
          <ActionRow
            icon={Brush}
            iconAnim="icon-anim-wiggle"
            label={t("admin.actions.vacuumDb")}
            description={maintenanceInfo.engine === "postgres" ? t("admin.actions.vacuumDescPg") : t("admin.actions.vacuumDesc")}
            onClick={() => setVacuumConfirmOpen(true)}
            status={rowStatus.vacuum}
          />
        </div>
      </div>

      {/* Danger zone */}
      <div>
        <SectionHeading danger>{t("admin.actions.dangerZone")}</SectionHeading>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ActionRow
            icon={MessageCircleX}
            iconAnim="icon-anim-sway"
            label={t("admin.actions.clearMessages")}
            description={t("admin.actions.clearMessagesDesc")}
            onClick={() =>
              setDanger({
                key: "clearMessages",
                title: t("admin.actions.clearMessages"),
                message: t("admin.actions.clearMessagesConfirm"),
                phrase: "clear messages",
                endpoint: "/api/admin/maintenance/clear-messages",
                busyLabel: t("admin.actions.clearing"),
                doneLabel: t("admin.actions.cleared"),
              })
            }
            status={rowStatus.clearMessages}
            danger
          />
          <ActionRow
            icon={Trash}
            iconAnim="icon-anim-slide"
            label={t("admin.actions.resetDb")}
            description={t("admin.actions.resetDbDesc")}
            onClick={() =>
              setDanger({
                key: "resetDb",
                title: t("admin.actions.resetDb"),
                message: t("admin.actions.resetDbConfirm"),
                phrase: "reset everything",
                endpoint: "/api/admin/maintenance/reset",
                busyLabel: t("admin.actions.resetting"),
                doneLabel: t("admin.actions.resetDone"),
              })
            }
            status={rowStatus.resetDb}
            danger
          />
          {maintenanceInfo.deleteAvailable && (
            <ActionRow
              icon={Trash}
              iconAnim="icon-anim-slide"
              label={t("admin.actions.deletePgDb")}
              description={maintenanceInfo.offlineDeleteRequired ? t("admin.actions.deletePgDescOffline") : t("admin.actions.deletePgDesc")}
              onClick={() =>
                setDanger({
                  key: "deleteDb",
                  title: t("admin.actions.deletePgDb"),
                  message: t("admin.actions.deletePgConfirm"),
                  phrase: "delete postgres database",
                  endpoint: "/api/admin/maintenance/delete",
                  busyLabel: t("admin.actions.deleting"),
                  doneLabel: t("admin.actions.deleted"),
                })
              }
              status={rowStatus.deleteDb}
              disabled={maintenanceInfo.offlineDeleteRequired}
              danger
            />
          )}
        </div>
      </div>

      <ConfirmModal
        open={vacuumConfirmOpen}
        title={t("admin.actions.vacuumDb")}
        message={maintenanceInfo.engine === "postgres" ? t("admin.actions.vacuumConfirmPg") : t("admin.actions.vacuumConfirm")}
        confirmLabel={rowStatus.vacuum?.type === "busy" ? t("admin.actions.vacuuming") : t("admin.actions.vacuum")}
        busy={rowStatus.vacuum?.type === "busy"}
        onConfirm={confirmVacuum}
        onClose={() => {
          if (rowStatus.vacuum?.type !== "busy") setVacuumConfirmOpen(false);
        }}
      />

      <ConfirmModal
        open={Boolean(pendingFile)}
        title={t("admin.actions.restoreDb")}
        message={
          pendingFile
            ? t("admin.actions.restoreConfirm", { name: pendingFile.name })
            : ""
        }
        confirmLabel={rowStatus.restore?.type === "busy" ? t("admin.actions.restoring") : t("admin.actions.restore")}
        busy={rowStatus.restore?.type === "busy"}
        onConfirm={confirmRestore}
        onClose={() => {
          if (rowStatus.restore?.type !== "busy") setPendingFile(null);
        }}
      />

      <ConfirmModal
        open={Boolean(serviceAction)}
        title={serviceAction === "stop" ? t("admin.actions.stopService") : t("admin.actions.restartService")}
        message={
          serviceAction === "stop"
            ? t("admin.actions.stopConfirm")
            : t("admin.actions.restartConfirm")
        }
        confirmLabel={
          rowStatus[serviceAction]?.type === "busy"
            ? t("admin.common.working")
            : serviceAction === "stop"
              ? t("admin.actions.stop")
              : t("admin.actions.restart")
        }
        busy={rowStatus[serviceAction]?.type === "busy"}
        onConfirm={confirmServiceAction}
        onClose={() => {
          if (rowStatus[serviceAction]?.type !== "busy") setServiceAction(null);
        }}
      />

      <TypedConfirmModal
        open={Boolean(danger)}
        title={danger?.title || ""}
        message={danger?.message || ""}
        phrase={danger?.phrase || ""}
        busy={danger ? rowStatus[danger.key]?.type === "busy" : false}
        onConfirm={confirmDanger}
        onClose={() => {
          if (!danger || rowStatus[danger.key]?.type !== "busy") setDanger(null);
        }}
      />
    </div>
  );
});

export default ActionsTab;
