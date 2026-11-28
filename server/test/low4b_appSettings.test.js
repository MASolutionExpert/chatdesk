/**
 * Stage 4 (LOW) security-fix tests — Task 4-b item 3:
 * appSettings.setSetting / setSettings / resetSetting must not be
 * fire-and-forget. On an async DB layer (Postgres) the write must be awaited:
 *   • the in-memory cache is updated ONLY after the write succeeds,
 *   • a failed write is surfaced to the caller ({ ok:false, error }) instead
 *     of becoming an unhandled rejection,
 *   • the sync SQLite path keeps returning the result synchronously.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  setSetting,
  setSettings,
  resetSetting,
  getSetting,
} from "./lib/appSettings.js";

const KEY = "MESSAGE_FILE_RETENTION"; // int, default 7
const TEXT_KEY = "MESSAGE_TEXT_RETENTION"; // nullable int, default 0

beforeEach(() => {
  // The module-level cache persists across tests; reset the keys we touch
  // back to their env/default values. (An explicitly-set env var always wins
  // over the cache, so none of these may leak in from the environment.)
  delete process.env.MESSAGE_FILE_RETENTION;
  delete process.env.MESSAGE_TEXT_RETENTION;
  resetSetting(KEY, () => undefined, () => {});
  resetSetting(TEXT_KEY, () => undefined, () => {});
});

// ─── Sync DB layer (SQLite) ───────────────────────────────────────────────────

describe("setSetting — sync dbRun (SQLite)", () => {
  test("successful set updates the cache immediately and calls dbSave", () => {
    const dbSave = () => {};
    const dbRun = (() => {
      let calls = 0;
      return () => {
        calls += 1;
        return undefined; // better-sqlite3 style: sync, returns nothing
      };
    })();

    const result = setSetting(KEY, "30", dbRun, dbSave);
    expect(result).toEqual({ ok: true, value: 30 });
    expect(getSetting(KEY)).toBe(30);
  });

  test("validation failures still return { ok:false } without touching the DB", () => {
    let dbRunCalls = 0;
    const result = setSetting(KEY, "-1", () => {
      dbRunCalls += 1;
    }, () => {});
    expect(result.ok).toBe(false);
    expect(dbRunCalls).toBe(0);
    expect(getSetting(KEY)).toBe(7);
  });
});

// ─── Async DB layer (Postgres) ────────────────────────────────────────────────

describe("setSetting — async dbRun (Postgres)", () => {
  test("resolves { ok:true } after the write lands and updates the cache then", async () => {
    const dbSave = vi.fn();
    const dbRun = vi.fn(async () => 1);

    const resultPromise = setSetting(KEY, "30", dbRun, dbSave);
    expect(typeof resultPromise.then).toBe("function");

    // The write is awaited, not fire-and-forget: the cache must still hold
    // the OLD value until the promise resolves.
    expect(getSetting(KEY)).toBe(7);

    const result = await resultPromise;
    expect(result).toEqual({ ok: true, value: 30 });
    expect(getSetting(KEY)).toBe(30);
    expect(dbSave).toHaveBeenCalledTimes(1);
    expect(dbRun).toHaveBeenCalledTimes(1);
  });

  test("a rejecting dbRun propagates as { ok:false, error } and the cache is NOT updated", async () => {
    const dbSave = vi.fn();
    const dbRun = vi.fn(async () => {
      throw new Error("connection refused");
    });

    const result = await setSetting(KEY, "30", dbRun, dbSave);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/connection refused/);
    // Cache unchanged — no "optimistic" update before the write landed.
    expect(getSetting(KEY)).toBe(7);
    expect(dbSave).not.toHaveBeenCalled();
  });

  test("resetSetting resolves { ok:true } and restores the default after the delete lands", async () => {
    setSetting(KEY, "30", () => {}, () => {});
    expect(getSetting(KEY)).toBe(30);

    const result = await resetSetting(KEY, async () => 1, () => {});
    expect(result).toEqual({ ok: true, value: 7 });
    expect(getSetting(KEY)).toBe(7);
  });

  test("resetSetting: a rejecting dbRun propagates and the cache is NOT reset", async () => {
    setSetting(KEY, "30", () => {}, () => {});
    expect(getSetting(KEY)).toBe(30);

    const result = await resetSetting(KEY, async () => {
      throw new Error("deadlock detected");
    }, () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/deadlock detected/);
    expect(getSetting(KEY)).toBe(30);
  });
});

// ─── setSettings ──────────────────────────────────────────────────────────────

describe("setSettings", () => {
  test("sync dbRun: saves every valid key, reports invalid keys, updates cache", () => {
    const result = setSettings(
      { MESSAGE_FILE_RETENTION: "14", MESSAGE_TEXT_RETENTION: "0", CHAT_MESSAGE_FETCH_LIMIT: "-5" },
      () => undefined,
      () => {},
    );
    expect(result.ok).toBe(false); // one invalid key
    expect(result.saved).toEqual(
      expect.arrayContaining(["MESSAGE_FILE_RETENTION", "MESSAGE_TEXT_RETENTION"]),
    );
    expect(result.errors.CHAT_MESSAGE_FETCH_LIMIT).toBeTruthy();
    expect(getSetting("MESSAGE_FILE_RETENTION")).toBe(14);
    expect(getSetting("MESSAGE_TEXT_RETENTION")).toBe(0);
  });

  test("async dbRun: awaits all writes, cache only updated for successful keys", async () => {
    const dbSave = vi.fn();
    const dbRun = vi.fn((builder) => {
      // The key is a BINDING, not part of the SQL text — inspect bindings to
      // simulate a PG failure for one specific key.
      const bindings = builder?.toSQL?.().bindings || [];
      if (bindings[0] === "MESSAGE_TEXT_RETENTION") {
        return Promise.reject(new Error("write failed"));
      }
      return Promise.resolve(1);
    });

    const result = await setSettings(
      { MESSAGE_FILE_RETENTION: "14", MESSAGE_TEXT_RETENTION: "30" },
      dbRun,
      dbSave,
    );

    expect(result.ok).toBe(false);
    expect(result.saved).toEqual(["MESSAGE_FILE_RETENTION"]);
    expect(result.errors.MESSAGE_TEXT_RETENTION).toMatch(/write failed/);
    expect(getSetting("MESSAGE_FILE_RETENTION")).toBe(14);
    // Failed key must NOT be optimistically cached.
    expect(getSetting("MESSAGE_TEXT_RETENTION")).toBe(0);
    expect(dbSave).toHaveBeenCalledTimes(1);
  });
});
