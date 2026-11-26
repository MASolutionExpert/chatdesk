import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import {
  LoaderCircle,
  Lock,
  PackageOpen,
  Refresh,
  Search,
  ShieldCheck,
} from "../../icons/lucide.js";
import { api, cardCls, inputSmCls } from "./adminShared.js";
import { useI18n } from "../../i18n/index.js";

// ─── Toggle — mirrors the SettingsTab switch (house style) ───────────────────

function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
      } ${checked ? "justify-end bg-emerald-500" : "justify-start bg-slate-300 dark:bg-slate-700"}`}
    >
      <span className="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition" />
    </button>
  );
}

// ─── One permission row ──────────────────────────────────────────────────────

function PermissionRow({ def, lang, onToggle, onReset, busyKeys, t }) {
  const label = lang === "fa" ? def.labelFa || def.labelEn : def.labelEn || def.key;
  const desc = lang === "fa" ? def.descFa || def.descEn : def.descEn || null;
  const busy = (role) => busyKeys.has(`${def.key}:${role}`);

  const renderRoleCell = (role) => {
    const cell = def.roles?.[role];
    if (!cell) return null;
    const overridden = cell.override !== null && cell.override !== undefined;
    return (
      <td className="px-3 py-2.5 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <Toggle
            checked={Boolean(cell.effective)}
            label={`${label} — ${role}`}
            disabled={busy(role)}
            onChange={(next) => onToggle(def, role, next)}
          />
          {overridden ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400"
              aria-hidden="true"
              title={t("admin.permissions.overriddenChip")}
            />
          ) : (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent"
              aria-hidden="true"
            />
          )}
          <button
            type="button"
            onClick={() => onReset(def, role)}
            disabled={!overridden || busy(role)}
            title={t("admin.permissions.resetTitle")}
            aria-label={`${t("admin.permissions.resetTitle")}: ${label} — ${role}`}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition ${
              overridden
                ? "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-200"
                : "cursor-default opacity-0"
            }`}
          >
            <Refresh size={12} />
          </button>
        </div>
      </td>
    );
  };

  return (
    <tr className="border-t border-slate-100 transition hover:bg-emerald-50/40 dark:border-white/5 dark:hover:bg-emerald-500/5">
      <td className="max-w-0 px-3 py-2.5">
        <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200" dir="auto">
          {label}
        </div>
        {desc ? (
          <div
            className="mt-0.5 line-clamp-2 text-xs text-slate-400 dark:text-slate-500"
            dir="auto"
          >
            {desc}
          </div>
        ) : null}
      </td>
      {renderRoleCell("operator")}
      {renderRoleCell("user")}
      <td className="px-3 py-2.5 text-center">
        <span
          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
          title={t("admin.permissions.ownerNote")}
        >
          <Lock size={9} /> {t("admin.permissions.ownerAlwaysFull")}
        </span>
      </td>
    </tr>
  );
}

// ─── The tab ─────────────────────────────────────────────────────────────────

const PermissionsTab = forwardRef(function PermissionsTab(
  { cachedData, isLoading, hasData, onMutated },
  ref,
) {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busyKeys, setBusyKeys] = useState(() => new Set());

  useImperativeHandle(ref, () => ({
    refresh: () => onMutated?.(),
  }));

  const data = cachedData;

  // Local mirror of the matrix so toggle changes feel instant; the server
  // response re-syncs it via onMutated → cache refresh.
  const [localOverride, setLocalOverride] = useState(null); // "role:permission" -> bool|null

  const groups = useMemo(() => {
    if (!Array.isArray(data?.groups)) return [];
    return data.groups;
  }, [data]);

  const permissions = useMemo(() => {
    if (!Array.isArray(data?.permissions)) return [];
    const list = data.permissions;
    if (!localOverride) return list;
    return list.map((def) => {
      const roles = { ...def.roles };
      for (const role of Object.keys(roles)) {
        const key = `${role}:${def.key}`;
        if (localOverride.has(key)) {
          const value = localOverride.get(key);
          roles[role] = {
            ...roles[role],
            override: value === null ? null : Boolean(value),
            effective: value === null ? roles[role].default : Boolean(value),
          };
        }
      }
      return { ...def, roles };
    });
  }, [data, localOverride]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return permissions;
    return permissions.filter((def) => {
      const haystack = [
        def.labelEn,
        def.labelFa,
        def.descEn,
        def.descFa,
        def.key,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [permissions, search]);

  const filteredGrouped = useMemo(() => {
    const byGroup = new Map();
    for (const def of filtered) {
      const key = def.group || "other";
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(def);
    }
    return byGroup;
  }, [filtered]);

  const setBusy = (key, busy) => {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const applyServerValue = (roleKey, permissionKey, effective, override) => {
    setLocalOverride((prev) => {
      const next = new Map(prev || []);
      next.set(`${roleKey}:${permissionKey}`, override);
      return next;
    });
    void effective;
  };

  const updatePermission = async (def, role, allowed) => {
    const busyKey = `${def.key}:${role}`;
    setBusy(busyKey, true);
    setSaveError("");
    // Optimistic flip:
    setLocalOverride((prev) => {
      const next = new Map(prev || []);
      next.set(`${role}:${def.key}`, allowed);
      return next;
    });
    try {
      const response = await api.put("/api/admin/permissions", {
        role,
        permission: def.key,
        allowed,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("admin.permissions.saveError"));
      }
      applyServerValue(role, def.key, payload?.effective, allowed);
      onMutated?.();
    } catch (err) {
      setSaveError(err?.message || t("admin.permissions.saveError"));
      // Revert the optimistic flip:
      setLocalOverride((prev) => {
        const next = new Map(prev || []);
        next.delete(`${role}:${def.key}`);
        return next;
      });
    } finally {
      setBusy(busyKey, false);
    }
  };

  const resetPermission = async (def, role) => {
    const busyKey = `${def.key}:${role}`;
    setBusy(busyKey, true);
    setSaveError("");
    setLocalOverride((prev) => {
      const next = new Map(prev || []);
      next.set(`${role}:${def.key}`, null);
      return next;
    });
    try {
      const response = await api.put("/api/admin/permissions", {
        role,
        permission: def.key,
        allowed: null,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("admin.permissions.saveError"));
      }
      onMutated?.();
    } catch (err) {
      setSaveError(err?.message || t("admin.permissions.saveError"));
      setLocalOverride((prev) => {
        const next = new Map(prev || []);
        next.delete(`${role}:${def.key}`);
        return next;
      });
    } finally {
      setBusy(busyKey, false);
    }
  };

  if (isLoading && !hasData) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400" dir="auto">
        <LoaderCircle size={16} className="animate-spin" />
        {t("admin.permissions.loading")}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-sm text-slate-400" dir="auto">
        <PackageOpen size={28} className="text-slate-300 dark:text-slate-600" />
        {t("admin.permissions.loadError")}
        <button
          type="button"
          onClick={() => onMutated?.()}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/50 dark:text-slate-300"
        >
          {t("admin.permissions.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Owner note */}
      <div className={`flex items-start gap-2.5 p-3 text-xs ${cardCls}`} dir="auto">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-500" />
        <span className="text-slate-500 dark:text-slate-400">
          {t("admin.permissions.ownerNote")}
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("admin.permissions.searchPlaceholder")}
          className={`${inputSmCls} pl-8`}
          dir="auto"
        />
      </div>

      {/* Matrix */}
      <div className={`overflow-hidden ${cardCls}`}>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400" dir="auto">
            {t("admin.permissions.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-slate-50/80 text-xs font-semibold text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
                  <th className="px-3 py-2.5 text-left font-semibold" dir="auto">
                    {t("admin.permissions.subtitle").split(".")[0]}
                  </th>
                  <th className="px-3 py-2.5 text-center font-semibold" dir="auto">
                    {t("admin.permissions.roleOperator")}
                  </th>
                  <th className="px-3 py-2.5 text-center font-semibold" dir="auto">
                    {t("admin.permissions.roleUser")}
                  </th>
                  <th className="px-3 py-2.5 text-center font-semibold" dir="auto">
                    {t("admin.permissions.ownerColumn")}
                  </th>
                </tr>
              </thead>
              {Array.from(filteredGrouped.entries()).map(([groupKey, defs]) => {
                const group = groups.find((g) => g.key === groupKey);
                const groupLabel = group
                  ? lang === "fa"
                    ? group.labelFa || group.labelEn
                    : group.labelEn || groupKey
                  : groupKey;
                return (
                  <tbody key={groupKey}>
                    <tr>
                      <td
                        colSpan={4}
                        className="bg-slate-50/60 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-white/[0.02] dark:text-slate-400"
                        dir="auto"
                      >
                        {groupLabel}
                      </td>
                    </tr>
                    {defs.map((def) => (
                      <PermissionRow
                        key={def.key}
                        def={def}
                        lang={lang}
                        t={t}
                        busyKeys={busyKeys}
                        onToggle={updatePermission}
                        onReset={resetPermission}
                      />
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </div>

      {/* Column hint */}
      <p className="px-1 text-xs text-slate-400 dark:text-slate-500" dir="auto">
        {t("admin.permissions.columnHint")}
      </p>

      {saveError ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
          dir="auto"
        >
          {saveError}
        </div>
      ) : null}
    </div>
  );
});

export default PermissionsTab;
