/**
 * Client-side permission helper for the configurable role permission
 * system (1.7.0).
 *
 * The server embeds the allowed registry keys for the user's role in
 * /api/me (and login/register). This helper reads them off the user
 * object for UI gating ONLY (showing/hiding buttons and menus) — every
 * gate is enforced server-side regardless of what the client renders.
 *
 * Fail-open policy: an absent/empty permissions array (stale localStorage
 * user, old server, cached session) means "unknown", not "denied" — the
 * UI stays as it was and the server's 403s remain the source of truth.
 */

const OWNER_ROLE = "owner";

/**
 * True when the user's role carries the registry permission.
 *
 * @param {object|null} user - normalized session user (with .role + .permissions)
 * @param {string} permissionKey - registry key, e.g. "ticket.refer"
 * @returns {boolean}
 */
export function hasPermission(user, permissionKey) {
  if (!user) return false;
  if (String(user.role || "").toLowerCase() === OWNER_ROLE) return true;
  const permissions = user.permissions;
  if (!Array.isArray(permissions) || permissions.length === 0) {
    // Unknown capability set → fail open; the server still enforces.
    return true;
  }
  return permissions.includes(permissionKey);
}

/**
 * Same as hasPermission but defaults to true when the user is missing
 * entirely (e.g. an anonymous render path) — again, display-only.
 */
export function canUseFeature(user, permissionKey) {
  if (!user) return true;
  return hasPermission(user, permissionKey);
}

// ─── Chat-scope helpers (mirror of server/lib/permissions.js) ────────────────

/**
 * Map a chat object to its message-permission scope:
 * 'dm' | 'ticket' | 'group'. Support threads count as tickets even after a
 * referral converts them to groups — and after their department was
 * hard-deleted: the ticket belongs to its customer↔operator pair, the
 * department is only the routing entry (mirrors the server's scope logic).
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

/** Registry key for a message action inside a chat. verb: 'edit' | 'delete_any' | 'delete_own' */
export function messagePermissionKey(chat, verb) {
  return `${chatMessageScope(chat)}.message.${verb}`;
}

/** Registry key for hard-deleting a whole chat thread (DM vs ticket). */
export function threadDeletePermissionKey(chat) {
  return chatMessageScope(chat) === "dm"
    ? "dm.thread.delete"
    : "ticket.delete";
}
