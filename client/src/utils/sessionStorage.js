import { normalizeUuid } from "./uuidUtils.js";

export const SESSION_USER_KEY = "chatdesk-session-user";

function getStorage() {
  if (typeof localStorage !== "undefined") return localStorage;
  if (typeof window !== "undefined" && window.localStorage)
    return window.localStorage;
  return null;
}

export function normalizeSessionUser(data) {
  if (!data?.username) return null;
  const userId = normalizeUuid(data.id) || null;
  return {
    id: userId,
    username: data.username,
    nickname: data.nickname || null,
    avatarUrl: data.avatarUrl || null,
    color: data.color || null,
    status: data.status || "online",
    role: data.role || "user",
    verified: Boolean(data.verified),
    // Configurable permission system (1.7.0): the allowed registry keys for
    // this role, served by /api/me (and login/register). The owner receives
    // the full registry. Missing/empty array (stale caches, old servers)
    // means "unknown" — hasPermission() then fails OPEN and the server
    // still enforces every gate server-side.
    permissions: Array.isArray(data.permissions)
      ? data.permissions.filter((key) => typeof key === "string" && key)
      : [],
    // Owner-impersonation stamp: present only while the owner is monitoring
    // through this session ("login as user" from the admin panel).
    impersonatedBy: data.impersonatedBy
      ? { id: data.impersonatedBy.id || null, username: data.impersonatedBy.username || null }
      : null,
  };
}

export function getSavedSessionUser() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.username
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function saveSessionUser(user) {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (user && typeof user === "object" && user.username) {
      storage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    } else {
      storage.removeItem(SESSION_USER_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function clearSavedSessionUser() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(SESSION_USER_KEY);
  } catch {
    // ignore storage failures
  }
}

export async function fetchSessionUser(apiBase = "") {
  let res;
  try {
    res = await fetch(`${apiBase}/api/me`, { credentials: "include" });
  } catch (cause) {
    const err = new Error("Network error: server unreachable");
    err.isNetworkError = true;
    err.cause = cause;
    throw err;
  }

  if (res.status === 401 || res.status === 403) {
    const err = new Error("No active session");
    err.isUnauthenticated = true;
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`Server error: status ${res.status}`);
    err.isServerError = true;
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const nextUser = normalizeSessionUser(data);
  if (!nextUser) {
    const err = new Error("Invalid session payload");
    err.isUnauthenticated = true;
    throw err;
  }
  return nextUser;
}
