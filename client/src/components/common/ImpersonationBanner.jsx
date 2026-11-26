import { useState } from "react";
import { LogOut } from "../../icons/lucide.js";
import { apiFetch } from "../../api/chatApi.js";
import { useI18n } from "../../i18n/index.js";

/**
 * Owner-impersonation monitoring banner.
 *
 * Rendered only while the current session was minted through the admin
 * panel's "login as user" (`/api/me` → `impersonatedBy`). Tells the viewer
 * (and anyone looking at the screen) that this is an owner monitoring
 * session, and offers the way back: POST /api/admin/impersonate/return
 * restores the parked owner session server-side, then a full reload boots
 * the app back as the owner.
 */
export default function ImpersonationBanner({ user }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const impersonatedBy = user?.impersonatedBy;

  if (!impersonatedBy) return null;

  const handleReturn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/impersonate/return", { method: "POST" });
      // Success boots back into the admin panel. If the parked session has
      // expired (or the request failed), fall back to a clean login.
      window.location.assign(res.ok ? "/admin" : "/login");
    } catch {
      window.location.assign("/login");
    }
  };

  return (
    <div
      role="status"
      className="flex w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-amber-300/60 bg-amber-100 px-3 py-1.5 text-center text-xs font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200"
    >
      <span>
        {t("common.impersonation.banner", {
          username: user.username,
          owner: impersonatedBy.username || t("common.impersonation.ownerFallback"),
        })}
      </span>
      <button
        type="button"
        onClick={handleReturn}
        disabled={busy}
        className={
          "inline-flex items-center gap-1 rounded-md border border-amber-400/70 bg-white/60 px-2 py-0.5 text-xs font-semibold text-amber-900 transition " +
          "hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 " +
          "dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30"
        }
      >
        <LogOut size={12} className={busy ? "animate-pulse" : ""} />
        {t("common.impersonation.return")}
      </button>
    </div>
  );
}
