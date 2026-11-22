import Tooltip from "./Tooltip.jsx";
import { useI18n } from "../../i18n/index.js";

/**
 * SupportChannelBadge — red headset badge marking a SUPPORT-channel message
 * thread (a helpdesk "ticket" opened through the department picker).
 *
 * This is the channel marker, not an identity marker:
 *   - VerifiedBadge  → the peer's identity is verified (sky blue).
 *   - UserRoleBadge  → the author's server role (gold/emerald/sky headset).
 *   - SupportChannelBadge → this conversation came through a support
 *     department (RED headset), i.e. "this message is from the user via
 *     the support section".
 *
 * Props:
 *   size            – icon size in px (default 15)
 *   departmentName  – optional department name shown in the tooltip
 *   className       – extra classes on the wrapper span
 */
export default function SupportChannelBadge({
  size = 15,
  departmentName = null,
  className = "",
}) {
  const { t } = useI18n();
  const baseLabel = t("common.supportChannelBadge");
  const label = departmentName
    ? `${baseLabel} — ${departmentName}`
    : baseLabel;

  return (
    <Tooltip label={label} className={`shrink-0 ${className}`}>
      <span
        className="inline-flex shrink-0 items-center"
        role="img"
        aria-label={label}
      >
        {/*
          Headset — same lucide shape as the operator UserRoleBadge, but
          filled RED to signal "message via the support channel".
        */}
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          fill="none"
        >
          <path
            d="M3 12a9 9 0 0 1 18 0v5a3 3 0 0 1-3 3h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3v-2a7 7 0 0 0-14 0v2h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6a3 3 0 0 1-3-3z"
            fill="#ef4444"
            className="dark:fill-red-400"
          />
        </svg>
      </span>
    </Tooltip>
  );
}
