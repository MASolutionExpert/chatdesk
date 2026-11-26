import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  LoaderCircle,
  PackageOpen,
  Palette,
  Plus,
  Trash,
  Upload,
  Refresh,
} from "../../icons/lucide.js";
import { api, btnPrimary, btnSecondary, btnDanger, cardCls, inputSmCls, labelCls } from "./adminShared.js";
import { apiFetch } from "../../api/chatApi.js";
import { useI18n } from "../../i18n/index.js";
import { buildLogoIconFormData } from "../../utils/logoPreprocess.js";

// Same icon set the server registry accepts (BRANDING_ICON_KEYS).
const LINK_ICON_OPTIONS = [
  { value: "website", labelKey: "admin.branding.iconWebsite" },
  { value: "github", labelKey: "admin.branding.iconGithub" },
  { value: "docker", labelKey: "admin.branding.iconDocker" },
  { value: "telegram", labelKey: "admin.branding.iconTelegram" },
  { value: "email", labelKey: "admin.branding.iconEmail" },
  { value: "railway", labelKey: "admin.branding.iconRailway" },
  { value: "chatdesk", labelKey: "admin.branding.iconChatdesk" },
];

function formFromConfig(config = {}) {
  return {
    aboutLinks: Array.isArray(config.aboutLinks)
      ? config.aboutLinks.map((link) => ({
          icon: String(link?.icon || "website"),
          href: String(link?.href || ""),
        }))
      : [],
    copyrightLabel: String(config.copyrightLabel || ""),
    copyrightHref: String(config.copyrightHref || ""),
    rightsText: String(config.rightsText || ""),
    loginTitle: String(config.loginTitle || ""),
    loginTagline: String(config.loginTagline || ""),
  };
}

const BrandingTab = forwardRef(function BrandingTab(
  { cachedData, isLoading, hasData, onMutated },
  ref,
) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => formFromConfig(cachedData || {}));
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const fileInputRef = useRef(null);
  const statusTimerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    refresh: () => onMutated?.(),
  }));

  // Re-sync the local form whenever the shared cache refreshes (after our own
  // save, a logo upload/reset, or a real-time mutation from another device).
  useEffect(() => {
    if (cachedData) setForm(formFromConfig(cachedData));
  }, [cachedData]);

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  const showToast = (msg, type = "success") => {
    setStatus({ msg, type });
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatus(null), 4000);
  };

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateLink = (index, key, value) => {
    setForm((prev) => {
      const links = prev.aboutLinks.map((link, i) =>
        i === index ? { ...link, [key]: value } : link,
      );
      return { ...prev, aboutLinks: links };
    });
  };

  const addLink = () => {
    setForm((prev) => {
      if (prev.aboutLinks.length >= 8) return prev;
      return {
        ...prev,
        aboutLinks: [...prev.aboutLinks, { icon: "website", href: "" }],
      };
    });
  };

  const removeLink = (index) => {
    setForm((prev) => ({
      ...prev,
      aboutLinks: prev.aboutLinks.filter((_, i) => i !== index),
    }));
  };

  const saveConfig = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const response = await api.put("/api/admin/branding", {
        aboutLinks: form.aboutLinks,
        copyrightLabel: form.copyrightLabel,
        copyrightHref: form.copyrightHref,
        rightsText: form.rightsText,
        loginTitle: form.loginTitle,
        loginTagline: form.loginTagline,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("admin.branding.saveError"));
      }
      showToast(t("admin.branding.saved"));
      onMutated?.();
    } catch (err) {
      setSaveError(err?.message || t("admin.branding.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleLogoFile = async (event) => {
    const file = event.target?.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLogoBusy(true);
    setSaveError("");
    try {
      const { formData } = await buildLogoIconFormData(file);
      const response = await apiFetch("/api/admin/branding/logo", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("admin.branding.saveError"));
      }
      showToast(t("admin.branding.logoUpdated"));
      onMutated?.();
    } catch (err) {
      const message = String(err?.message || "");
      const key = /image file|image\./i.test(message)
        ? "admin.branding.invalidImage"
        : /PNG conversion/i.test(message)
          ? "admin.branding.convertError"
          : null;
      setSaveError(key ? t(key) : message || t("admin.branding.saveError"));
    } finally {
      setLogoBusy(false);
    }
  };

  const resetLogo = async () => {
    setLogoBusy(true);
    setSaveError("");
    try {
      const response = await apiFetch("/api/admin/branding/logo", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("admin.branding.saveError"));
      }
      showToast(t("admin.branding.logoResetDone"));
      onMutated?.();
    } catch (err) {
      setSaveError(err?.message || t("admin.branding.saveError"));
    } finally {
      setLogoBusy(false);
    }
  };

  if (isLoading && !hasData) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400" dir="auto">
        <LoaderCircle size={16} className="animate-spin" />
        {t("admin.branding.loading")}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-sm text-slate-400" dir="auto">
        <PackageOpen size={28} className="text-slate-300 dark:text-slate-600" />
        {t("admin.branding.loadError")}
        <button
          type="button"
          onClick={() => onMutated?.()}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/50 dark:text-slate-300"
        >
          {t("admin.branding.retry")}
        </button>
      </div>
    );
  }

  const logoUrl = cachedData?.logo?.logoUrl || null;
  const busy = saving || logoBusy;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Intro note */}
      <div className={`flex items-start gap-2.5 p-3 text-xs ${cardCls}`} dir="auto">
        <Palette size={16} className="mt-0.5 shrink-0 text-emerald-500" />
        <span className="text-slate-500 dark:text-slate-400">
          {t("admin.branding.subtitle")}
        </span>
      </div>

      {/* ── Entry page: logo + title + tagline ─────────────────────────────── */}
      <section className={`space-y-4 p-4 ${cardCls}`}>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200" dir="auto">
          {t("admin.branding.entryTitle")}
        </h2>

        <div className="flex flex-wrap items-center gap-4">
          <img
            src={logoUrl || "/chatdesk-logo.svg"}
            alt={t("admin.branding.logoLabel")}
            className={`h-16 w-16 shrink-0 object-cover ${logoUrl ? "rounded-[22.5%] shadow-sm" : ""}`}
          />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className={btnPrimary}
            >
              {logoBusy ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {logoBusy ? t("admin.branding.logoUploading") : t("admin.branding.logoUpload")}
            </button>
            {logoUrl ? (
              <button
                type="button"
                disabled={busy}
                onClick={resetLogo}
                className={btnDanger}
              >
                <Refresh size={14} />
                {t("admin.branding.logoReset")}
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label={t("admin.branding.logoLabel")}
              onChange={handleLogoFile}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500" dir="auto">
          {t("admin.branding.logoHint")}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className={labelCls} htmlFor="branding-login-title" dir="auto">
              {t("admin.branding.loginTitle")}
            </label>
            <input
              id="branding-login-title"
              type="text"
              value={form.loginTitle}
              maxLength={60}
              placeholder={t("admin.branding.loginTitlePlaceholder")}
              onChange={(e) => update("loginTitle", e.target.value)}
              className={inputSmCls}
              dir="auto"
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls} htmlFor="branding-login-tagline" dir="auto">
              {t("admin.branding.loginTagline")}
            </label>
            <input
              id="branding-login-tagline"
              type="text"
              value={form.loginTagline}
              maxLength={120}
              placeholder={t("admin.branding.loginTaglinePlaceholder")}
              onChange={(e) => update("loginTagline", e.target.value)}
              className={inputSmCls}
              dir="auto"
            />
          </div>
        </div>
      </section>

      {/* ── About dialog ───────────────────────────────────────────────────── */}
      <section className={`space-y-4 p-4 ${cardCls}`}>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200" dir="auto">
          {t("admin.branding.aboutTitle")}
        </h2>

        {/* Configurable links */}
        <div className="space-y-2">
          <span className={labelCls} dir="auto">
            {t("admin.branding.linksLabel")}
          </span>
          {form.aboutLinks.map((link, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                value={link.icon}
                aria-label={t("admin.branding.linkIcon")}
                onChange={(e) => updateLink(index, "icon", e.target.value)}
                className={`${inputSmCls} w-36 shrink-0`}
              >
                {LINK_ICON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
              <input
                type="url"
                value={link.href}
                placeholder="https://…"
                aria-label={t("admin.branding.linkUrl")}
                onChange={(e) => updateLink(index, "href", e.target.value)}
                className={`${inputSmCls} min-w-0 flex-1`}
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => removeLink(index)}
                aria-label={t("admin.branding.removeLink")}
                title={t("admin.branding.removeLink")}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addLink}
            disabled={form.aboutLinks.length >= 8}
            className={btnSecondary}
          >
            <Plus size={14} />
            {t("admin.branding.addLink")}
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className={labelCls} htmlFor="branding-copyright-label" dir="auto">
              {t("admin.branding.copyrightLabel")}
            </label>
            <input
              id="branding-copyright-label"
              type="text"
              value={form.copyrightLabel}
              maxLength={120}
              onChange={(e) => update("copyrightLabel", e.target.value)}
              className={inputSmCls}
              dir="auto"
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls} htmlFor="branding-copyright-href" dir="auto">
              {t("admin.branding.copyrightHref")}
            </label>
            <input
              id="branding-copyright-href"
              type="url"
              value={form.copyrightHref}
              placeholder="https://…"
              onChange={(e) => update("copyrightHref", e.target.value)}
              className={inputSmCls}
              dir="ltr"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className={labelCls} htmlFor="branding-rights-text" dir="auto">
            {t("admin.branding.rightsText")}
          </label>
          <textarea
            id="branding-rights-text"
            value={form.rightsText}
            maxLength={500}
            rows={2}
            placeholder={t("admin.branding.rightsTextPlaceholder")}
            onChange={(e) => update("rightsText", e.target.value)}
            className={`${inputSmCls} h-auto py-2`}
            dir="auto"
          />
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={saveConfig} disabled={busy} className={btnPrimary}>
          {saving ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : null}
          {saving ? t("admin.branding.saving") : t("admin.branding.save")}
        </button>
      </div>

      {status ? (
        <div
          role="status"
          className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
            status.type === "error"
              ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          }`}
          dir="auto"
        >
          {status.msg}
        </div>
      ) : null}

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

export default BrandingTab;
