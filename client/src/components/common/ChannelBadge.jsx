import Tooltip from "./Tooltip.jsx";
import { useI18n } from "../../i18n/index.js";

/**
 * ChannelBadge — text pill marking the channel a conversation belongs to.
 *
 * ChatDesk separates two strictly distinct DM channels (migration 044
 * `chats.channel`) and labels them everywhere a chat or a message is shown:
 *
 *   - "support"  → SUPPORT pill (rose): the thread is a helpdesk ticket
 *     opened through the department picker (`chats.department_id` is set).
 *   - "direct"   → MESSENGER pill (slate): a messenger-style chat opened by
 *     finding a user's ID (user↔operator, operator↔operator).
 *
 * This is a channel marker, not an identity marker — it never overlaps with:
 *   - VerifiedBadge   → the peer's identity is verified (sky icon).
 *   - UserRoleBadge   → the author's server role (gold/emerald/sky icon).
 *
 * Props:
 *   channel         – "support" | "direct" (default "direct")
 *   departmentName  – optional department name appended to the tooltip
 *   className       – extra classes on the wrapper span
 */
const CHANNELS = {
  support: {
    label: "SUPPORT",
    labelKey: "common.channelBadgeSupport",
    pill:
      "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/30",
  },
  direct: {
    label: "MESSENGER",
    labelKey: "common.channelBadgeMessenger",
    pill:
      "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-400/30",
  },
};

export default function ChannelBadge({
  channel = "direct",
  departmentName = null,
  className = "",
}) {
  const { t } = useI18n();
  const conf = CHANNELS[channel] || CHANNELS.direct;
  const baseLabel = t(conf.labelKey);
  const label = departmentName ? `${baseLabel} — ${departmentName}` : baseLabel;

  return (
    <Tooltip label={label} className={`shrink-0 ${className}`}>
      <span
        className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[9px] font-bold uppercase leading-[14px] tracking-wider ${conf.pill}`}
        role="img"
        aria-label={label}
        dir="ltr"
      >
        {conf.label}
      </span>
    </Tooltip>
  );
}
