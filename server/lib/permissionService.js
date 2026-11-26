/**
 * Permission service — DB-backed role permission resolution on top of the
 * registry (server/lib/permissions.js).
 *
 * Storage model: the `role_permissions` table (migration 048) stores ONLY
 * explicit admin overrides as (role, permission, allowed) rows. Effective
 * permission = override ?? registry default. This keeps future registry
 * additions zero-migration: a new permission simply appears with its
 * built-in defaults until an admin overrides it.
 *
 * Caching: per-role in-memory cache with a short TTL, invalidated eagerly
 * on every write. Single-process Node server — no cross-process concerns.
 *
 * Dual dialect: every query is a knex builder pushed through db.js's
 * getAll/run helpers (SQLite locally, PostgreSQL in production — no raw
 * SQL, no dialect-specific upsert).
 */

import {
  ALL_PERMISSION_KEYS,
  CONFIGURABLE_ROLES,
  isKnownPermission,
  resolveEffectivePermission,
} from "./permissions.js";

const CACHE_TTL_MS = 30_000;

export function createPermissionService({ getAll, run, knex }) {
  const cache = new Map(); // role -> { overrides: Map<key, 0|1>, loadedAt }

  const normalizeRole = (role) => String(role || "").toLowerCase();

  async function loadOverrides(role) {
    const cached = cache.get(role);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.overrides;
    }
    const rows =
      (await getAll(
        knex("role_permissions")
          .select("permission", "allowed")
          .where({ role }),
      )) || [];
    const overrides = new Map();
    for (const row of rows) {
      if (isKnownPermission(row.permission)) {
        overrides.set(row.permission, Number(row.allowed) ? 1 : 0);
      }
    }
    cache.set(role, { overrides, loadedAt: Date.now() });
    return overrides;
  }

  function invalidate(role) {
    if (role) cache.delete(normalizeRole(role));
    else cache.clear();
  }

  /** Effective allowance for (role, permissionKey). Owner always true. */
  async function isAllowed(role, permissionKey) {
    const normalized = normalizeRole(role);
    if (normalized === "owner") return true;
    if (!isKnownPermission(permissionKey)) return false;
    const overrides = await loadOverrides(normalized);
    return resolveEffectivePermission(
      normalized,
      permissionKey,
      Object.fromEntries(overrides),
    );
  }

  /**
   * All registry keys currently allowed for a role — the array embedded in
   * /api/me, /api/login and /api/register responses for the client UI.
   */
  async function getAllowedKeys(role) {
    const normalized = normalizeRole(role);
    if (normalized === "owner") return [...ALL_PERMISSION_KEYS];
    const overrides = await loadOverrides(normalized);
    const overrideObj = Object.fromEntries(overrides);
    return ALL_PERMISSION_KEYS.filter((key) =>
      resolveEffectivePermission(normalized, key, overrideObj),
    );
  }

  /**
   * Full matrix for the admin panel: per permission, per configurable role,
   * the registry default, any stored override, and the effective value.
   */
  async function getMatrix() {
    const byRole = {};
    for (const role of CONFIGURABLE_ROLES) {
      byRole[role] = Object.fromEntries(await loadOverrides(role));
    }
    return {
      roles: [...CONFIGURABLE_ROLES],
      permissions: ALL_PERMISSION_KEYS.map((key) => {
        const roles = {};
        for (const role of CONFIGURABLE_ROLES) {
          const override = byRole[role][key];
          roles[role] = {
            default: resolveEffectivePermission(role, key, {}),
            override: override === 0 ? false : override === 1 ? true : null,
            effective: resolveEffectivePermission(role, key, byRole[role]),
          };
        }
        return { key, roles };
      }),
    };
  }

  /** Raw override rows (admin diagnostics). */
  async function listOverrides() {
    return (
      (await getAll(
        knex("role_permissions")
          .select("role", "permission", "allowed", "updated_at")
          .orderBy("role"),
      )) || []
    );
  }

  /**
   * Store or clear an override. `allowed === null` resets to the registry
   * default (removes the row). Returns the new effective value.
   * update-then-insert keeps the upsert portable across SQLite and PG.
   */
  async function setOverride({ role, permission, allowed }) {
    const normalized = normalizeRole(role);
    if (!CONFIGURABLE_ROLES.includes(normalized)) {
      throw new Error(
        `Role '${role}' is not configurable (owner always has full access).`,
      );
    }
    if (!isKnownPermission(permission)) {
      throw new Error(`Unknown permission '${permission}'.`);
    }
    if (allowed === null || allowed === undefined) {
      await run(
        knex("role_permissions")
          .where({ role: normalized, permission })
          .del(),
      );
    } else {
      const value = allowed ? 1 : 0;
      const updated = await run(
        knex("role_permissions")
          .where({ role: normalized, permission })
          .update({ allowed: value, updated_at: new Date().toISOString() }),
      );
      if (!updated) {
        await run(
          knex("role_permissions").insert({
            role: normalized,
            permission,
            allowed: value,
            updated_at: new Date().toISOString(),
          }),
        );
      }
    }
    invalidate(normalized);
    return isAllowed(normalized, permission);
  }

  return {
    isAllowed,
    getAllowedKeys,
    getMatrix,
    listOverrides,
    setOverride,
    invalidate,
  };
}
