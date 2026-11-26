import { useEffect, useState } from "react";
import { Mail, Globe } from "../../../icons/lucide.js";
import {
  DockerIcon,
  GithubIcon,
  RailwayIcon,
  ChatDeskIcon,
  TelegramIcon,
} from "../../../icons/BrandIcons.jsx";
import { ABOUT_CONTENT } from "../../../settings/aboutContent.js";
import Tooltip from "../../common/Tooltip.jsx";
import { useI18n } from "../../../i18n/index.js";
import { loadBranding } from "../../../utils/branding.js";

// Configurable link icons (admin Personalization tab → «شخصی‌سازی»).
// `website` is the generic globe icon the owner can point at any site.
const LINK_ICONS = {
  website: Globe,
  github: GithubIcon,
  docker: DockerIcon,
  telegram: TelegramIcon,
  email: Mail,
  railway: RailwayIcon,
  chatdesk: ChatDeskIcon,
};

export function AboutSettingsPanel({
  appInfo,
  appInfoLoading,
  onDone,
  variant = "desktop",
}) {
  const isMobile = variant === "mobile";
  const { t } = useI18n();
  const versionLabel = String(appInfo?.version || "").trim();

  // Owner-configurable About content; falls back to the bundled defaults
  // while loading / when the endpoint is unavailable.
  const [branding, setBranding] = useState(null);
  useEffect(() => {
    let isMounted = true;
    loadBranding().then((payload) => {
      if (isMounted && payload) setBranding(payload);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const links = Array.isArray(branding?.aboutLinks)
    ? branding.aboutLinks
    : ABOUT_CONTENT.socials.map(({ icon, href }) => ({ icon, href }));
  const copyrightLabel = String(
    branding?.copyrightLabel || ABOUT_CONTENT.copyright?.ownerLabel || "",
  ).trim();
  const copyrightHref = String(
    branding?.copyrightHref || ABOUT_CONTENT.copyright?.ownerHref || "",
  ).trim();
  const rightsText = String(branding?.rightsText || "").trim() || t("settings.about.rights");
  const year = new Date().getFullYear();
  const rowBase =
    "flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-200/70 bg-white/90 px-4 py-3 text-left text-sm font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-slate-900/50 dark:text-emerald-200";

  return (
    <div className="space-y-4 text-slate-600 dark:text-slate-300">
      <div
        className={
          isMobile
            ? "space-y-3"
            : "app-scroll max-h-[calc(100dvh-18rem)] space-y-3 overflow-y-auto pr-1"
        }
      >
        {/* The version always stays on top and is never editable. */}
        <div className={rowBase}>
          <p>{t("settings.about.version")}</p>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {appInfoLoading
              ? t("common.actions.loading")
              : versionLabel || t("settings.about.unknown")}
          </span>
        </div>

        <div className="border-t border-emerald-100/80 pt-4 dark:border-emerald-500/20">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {links.map((item) => {
              const Icon = LINK_ICONS[item.icon];
              const label = String(item.icon || "");
              return (
                <Tooltip key={`${item.icon}-${item.href}`} label={label}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={label}
                    className="group inline-flex items-center justify-center p-1 text-slate-500 transition hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-200"
                  >
                    <span className="inline-flex items-center justify-center text-slate-600 transition group-hover:text-emerald-700 dark:text-slate-300 dark:group-hover:text-emerald-200">
                      {Icon ? <Icon size={24} /> : null}
                    </span>
                  </a>
                </Tooltip>
              );
            })}
          </div>

          <p className="mt-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
            {rightsText}
          </p>

          {/* The copyright line stays at the very bottom of the dialog. */}
          <p className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
            {"\u00A9"} {year}{" "}
            {copyrightHref ? (
              <a
                href={copyrightHref}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-slate-600 underline-offset-4 transition hover:text-emerald-700 hover:underline dark:text-slate-300 dark:hover:text-emerald-200"
              >
                {copyrightLabel || "ChatDesk"}
              </a>
            ) : (
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                {copyrightLabel || "ChatDesk"}
              </span>
            )}
          </p>
        </div>
      </div>

      {!isMobile ? (
        <div className="flex items-center justify-end pt-1">
          <button
            type="button"
            onClick={() => onDone?.()}
            className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-400"
          >
            {t("common.actions.done")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
