/**
 * Permission registry — the single source of truth for ChatDesk's
 * configurable role permission system (1.7.0).
 *
 * Design goals (the "rebuild from the roots" requirement):
 *   1. REGISTRY-DRIVEN: every permission is declared exactly once, here, with
 *      its labels, group, and per-role defaults. No permission logic is
 *      scattered as bare role comparisons inside route handlers anymore —
 *      handlers call `deps.hasPermission(role, KEY)`.
 *   2. EXTENSIBLE: adding a future permission = adding one entry to
 *      PERMISSION_DEFS (+ using its key in the relevant handler). No migration
 *      is required: the DB stores only ADMIN OVERRIDES per (role, permission),
 *      so new registry entries automatically appear in the admin panel with
 *      their built-in defaults. Existing deployments never break.
 *   3. OWNER = FULL: the instance owner (`users.role === 'owner'`) always has
 *      every permission — enforced centrally (service short-circuits true)
 *      and mirrored in the client. The owner is NOT a configurable row in
 *      the matrix; the admin UI renders it as a locked "always full" column.
 *
 * Configurable roles: 'operator' and 'user'. Defaults below reproduce the
 * pre-1.7.0 hard-coded behaviour EXACTLY (membership/author/chat-owner
 * constraints stay in place in the handlers — the registry only adds the
 * role-level gate on top).
 *
 * Dual-language labels (en/fa) render directly in the admin panel matrix.
 */

/** Roles that can be configured in the admin permission matrix. */
export const CONFIGURABLE_ROLES = ["operator", "user"];

/** All roles known to the permission system (owner first = always full). */
export const ALL_ROLES = ["owner", ...CONFIGURABLE_ROLES];

/** Permission groups (rendered as sections in the admin panel). */
export const PERMISSION_GROUPS = [
  {
    key: "tickets",
    labelEn: "Tickets",
    labelFa: "تیکت‌ها",
    descEn: "Creating, closing, referring and deleting support tickets.",
    descFa: "ساخت، بستن، ارجاع و حذف تیکت‌های پشتیبانی.",
  },
  {
    key: "messaging",
    labelEn: "Direct messages",
    labelFa: "پیام‌رسانی",
    descEn: "Direct (messenger) chats and their messages.",
    descFa: "گفتگوهای مستقیم (پیام‌رسانی) و پیام‌های آن‌ها.",
  },
  {
    key: "calls",
    labelEn: "Calls",
    labelFa: "تماس‌ها",
    descEn: "Voice and video calls and their history.",
    descFa: "تماس‌های صوتی و تصویری و تاریخچه آن‌ها.",
  },
  {
    key: "chats",
    labelEn: "Groups & channels",
    labelFa: "گروه‌ها و کانال‌ها",
    descEn: "Creating, leaving and deleting groups and channels.",
    descFa: "ساخت، ترک و حذف گروه‌ها و کانال‌ها.",
  },
];

/**
 * The registry. `defaults` maps each CONFIGURABLE role to its built-in
 * allowance; the owner is intentionally absent (always true, never stored).
 */
export const PERMISSION_DEFS = [
  // ── Tickets ────────────────────────────────────────────────────────────────
  {
    key: "ticket.create",
    group: "tickets",
    labelEn: "Create tickets",
    labelFa: "ارسال تیکت",
    descEn: "Open new support tickets through the department picker.",
    descFa: "باز کردن تیکت پشتیبانی جدید از طریق انتخاب دپارتمان.",
    defaults: { operator: true, user: true },
  },
  {
    key: "ticket.close",
    group: "tickets",
    labelEn: "Close & reopen tickets",
    labelFa: "بستن و باز کردن تیکت",
    descEn: "Close an open ticket or reopen a closed one.",
    descFa: "بستن تیکت باز یا باز کردن دوباره تیکت بسته‌شده.",
    defaults: { operator: true, user: true },
  },
  {
    key: "ticket.refer",
    group: "tickets",
    labelEn: "Refer tickets",
    labelFa: "ارجاع تیکت",
    descEn: "Hand a ticket to another operator (converts it to a support group).",
    descFa: "تحویل تیکت به اپراتور دیگر (تبدیل به گروه پشتیبانی).",
    defaults: { operator: true, user: false },
  },
  {
    key: "ticket.delete",
    group: "tickets",
    labelEn: "Delete tickets",
    labelFa: "حذف تیکت",
    descEn: "Hard-delete a ticket thread (including referred support groups).",
    descFa: "حذف کامل رشتهٔ تیکت (شامل گروه‌های پشتیبانی ارجاع‌شده).",
    defaults: { operator: false, user: false },
  },
  {
    key: "ticket.message.delete_any",
    group: "tickets",
    labelEn: "Delete any message in tickets",
    labelFa: "حذف هر پیام در تیکت",
    descEn: "Delete any message inside a ticket — not only one's own.",
    descFa: "حذف هر پیام داخل تیکت — نه فقط پیام‌های خود.",
    defaults: { operator: false, user: false },
  },
  {
    key: "ticket.message.edit",
    group: "tickets",
    labelEn: "Edit messages in tickets",
    labelFa: "ویرایش پیام در تیکت",
    descEn: "Edit one's own messages inside a ticket.",
    descFa: "ویرایش پیام‌های خود داخل تیکت.",
    defaults: { operator: true, user: false },
  },

  // ── Direct messages ────────────────────────────────────────────────────────
  {
    key: "dm.send",
    group: "messaging",
    labelEn: "Send direct messages",
    labelFa: "ارسال پیام مسنجری",
    descEn: "Open and write in direct (messenger) chats.",
    descFa: "باز کردن گفتگوهای مستقیم و نوشتن در آن‌ها.",
    defaults: { operator: true, user: true },
  },
  {
    key: "dm.thread.delete",
    group: "messaging",
    labelEn: "Delete direct message chats",
    labelFa: "حذف گفتگوهای مسنجری",
    descEn: "Hard-delete a direct-message thread.",
    descFa: "حذف کامل یک گفتگوی مستقیم.",
    defaults: { operator: false, user: false },
  },
  {
    key: "dm.message.delete_own",
    group: "messaging",
    labelEn: "Delete own direct messages",
    labelFa: "حذف پیام‌های خود در مسنجری",
    descEn: "Delete one's own messages from a direct chat (for oneself).",
    descFa: "حذف پیام‌های خود از گفتگوی مستقیم (برای خود).",
    defaults: { operator: false, user: false },
  },
  {
    key: "dm.message.delete_any",
    group: "messaging",
    labelEn: "Delete any message in direct messages",
    labelFa: "حذف هر پیام در پیام مسنجری",
    descEn: "Delete any message in a direct chat — not only one's own.",
    descFa: "حذف هر پیام در گفتگوی مستقیم — نه فقط پیام‌های خود.",
    defaults: { operator: false, user: false },
  },
  {
    key: "dm.message.edit",
    group: "messaging",
    labelEn: "Edit messages in direct messages",
    labelFa: "ویرایش پیام در پیام مسنجری",
    descEn: "Edit one's own messages in a direct chat.",
    descFa: "ویرایش پیام‌های خود در گفتگوی مستقیم.",
    defaults: { operator: true, user: false },
  },

  // ── Calls ──────────────────────────────────────────────────────────────────
  {
    key: "call.voice",
    group: "calls",
    labelEn: "Voice calls",
    labelFa: "تماس صوتی",
    descEn: "Start voice calls in direct chats.",
    descFa: "شروع تماس صوتی در گفتگوهای مستقیم.",
    defaults: { operator: true, user: true },
  },
  {
    key: "call.video",
    group: "calls",
    labelEn: "Video calls",
    labelFa: "تماس تصویری (ویدیو کال)",
    descEn: "Start video calls in direct chats.",
    descFa: "شروع تماس تصویری در گفتگوهای مستقیم.",
    defaults: { operator: true, user: true },
  },
  {
    key: "call.history.delete",
    group: "calls",
    labelEn: "Delete voice call entries",
    labelFa: "حذف تماس",
    descEn: "Remove voice-call entries from one's own chat history.",
    descFa: "حذف ورودی‌های تماس صوتی از تاریخچهٔ خود.",
    defaults: { operator: true, user: true },
  },
  {
    key: "call.video.history.delete",
    group: "calls",
    labelEn: "Delete video call entries",
    labelFa: "حذف ویدیو کال",
    descEn: "Remove video-call entries from one's own chat history.",
    descFa: "حذف ورودی‌های تماس تصویری از تاریخچهٔ خود.",
    defaults: { operator: true, user: true },
  },

  // ── Groups & channels ──────────────────────────────────────────────────────
  {
    key: "group.create",
    group: "chats",
    labelEn: "Create groups",
    labelFa: "ساخت گروه",
    descEn: "Create new group chats.",
    descFa: "ساخت گروه‌های گفتگوی جدید.",
    defaults: { operator: true, user: true },
  },
  {
    key: "channel.create",
    group: "chats",
    labelEn: "Create channels",
    labelFa: "ساخت کانال",
    descEn: "Create new channels.",
    descFa: "ساخت کانال‌های جدید.",
    defaults: { operator: true, user: true },
  },
  {
    key: "chat.leave",
    group: "chats",
    labelEn: "Leave groups & channels",
    labelFa: "ترک گروه و کانال",
    descEn: "Leave a group or channel one belongs to.",
    descFa: "ترک گروه یا کانالی که عضو آن است.",
    defaults: { operator: true, user: true },
  },
  {
    key: "group.delete",
    group: "chats",
    labelEn: "Delete groups",
    labelFa: "حذف گروه",
    descEn: "Delete a group one owns (chat-owner rule still applies).",
    descFa: "حذف گروهی که مالک آن است (قاعدهٔ مالک گروه همچنان برقرار است).",
    defaults: { operator: true, user: true },
  },
  {
    key: "channel.delete",
    group: "chats",
    labelEn: "Delete channels",
    labelFa: "حذف کانال",
    descEn: "Delete a channel one owns (chat-owner rule still applies).",
    descFa: "حذف کانالی که مالک آن است (قاعدهٔ مالک گروه همچنان برقرار است).",
    defaults: { operator: true, user: true },
  },
  {
    key: "group.message.delete_any",
    group: "chats",
    labelEn: "Delete any message in groups",
    labelFa: "حذف هر پیام در گروه",
    descEn: "Delete any message in a group or channel — not only one's own.",
    descFa: "حذف هر پیام در گروه یا کانال — نه فقط پیام‌های خود.",
    defaults: { operator: false, user: false },
  },
  {
    key: "group.message.edit",
    group: "chats",
    labelEn: "Edit messages in groups",
    labelFa: "ویرایش پیام در گروه",
    descEn: "Edit one's own messages in a group or channel.",
    descFa: "ویرایش پیام‌های خود در گروه یا کانال.",
    defaults: { operator: true, user: false },
  },
];

const DEFS_BY_KEY = new Map(PERMISSION_DEFS.map((def) => [def.key, def]));

/** All registry permission keys, in declared order. */
export const ALL_PERMISSION_KEYS = PERMISSION_DEFS.map((def) => def.key);

/** True when `key` is a registered permission. */
export function isKnownPermission(key) {
  return DEFS_BY_KEY.has(String(key || ""));
}

/** Registry definition for a key (or null). */
export function getPermissionDef(key) {
  return DEFS_BY_KEY.get(String(key || "")) || null;
}

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

/**
 * Built-in registry default for (role, permission). The owner short-circuits
 * to true before this is ever consulted; unknown roles fall back to the
 * most restrictive default of the configurable roles (false) unless every
 * configurable role's default is true — mirroring "regular member" power.
 */
export function getDefaultPermission(role, key) {
  const normalized = normalizeRole(role);
  if (normalized === "owner") return true;
  const def = getPermissionDef(key);
  if (!def) return false; // unknown permission → deny (fail-closed)
  // Known configurable roles read their own default.
  if (CONFIGURABLE_ROLES.includes(normalized)) {
    return Boolean(def.defaults[normalized]);
  }
  // A role outside owner/operator/user behaves like the least-privileged
  // configured role: allow only if every configurable role is allowed.
  const defaults = CONFIGURABLE_ROLES.map((r) => Boolean(def.defaults[r]));
  if (defaults.length === 0) return false;
  return defaults.every(Boolean);
}

/**
 * Effective permission for (role, permission) given an override map.
 * `overrides` maps permission key → 0/1/true/false (DB rows for the role);
 * a missing entry falls back to the registry default.
 */
export function resolveEffectivePermission(role, key, overrides = {}) {
  if (normalizeRole(role) === "owner") return true;
  const override = overrides[key];
  if (override === 0 || override === 1) return Boolean(override);
  if (typeof override === "boolean") return override;
  return getDefaultPermission(role, key);
}

/**
 * Map a chat object to its message-permission scope ('dm' | 'ticket' | 'group').
 * Support threads count as tickets even after a referral converts them to
 * groups — and after their department was hard-deleted: the ticket belongs to
 * its customer↔operator pair, the department is only the routing entry.
 */
export function chatMessageScope(chat) {
  const type = String(chat?.type || "").toLowerCase();
  const channel = String(chat?.channel || "direct").toLowerCase();
  if (type === "dm") {
    return channel === "support" ? "ticket" : "dm";
  }
  if (
    channel === "support" &&
    (type === "group" || type === "channel")
  ) {
    return "ticket"; // referred support group
  }
  return "group";
}

/**
 * Registry key for a message action inside a chat.
 * `verb`: 'edit' | 'delete_any' | 'delete_own'.
 */
export function messagePermissionKey(chat, verb) {
  return `${chatMessageScope(chat)}.message.${verb}`;
}

/** Registry key for deleting (hard-deleting) a whole chat thread. */
export function threadDeletePermissionKey(chat) {
  return chatMessageScope(chat) === "dm"
    ? "dm.thread.delete"
    : "ticket.delete";
}

/**
 * Registry key for deleting a call-history entry from its [[call:…]] body.
 * Returns null when the body is not a call entry.
 */
export function callHistoryPermissionKey(messageBody) {
  const body = String(messageBody || "");
  if (!body.startsWith("[[call:")) return null;
  const kind = body.split(":")[1] || "";
  return kind === "video" ? "call.video.history.delete" : "call.history.delete";
}
