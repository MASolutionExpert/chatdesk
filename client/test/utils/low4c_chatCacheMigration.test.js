import { beforeEach, describe, expect, test, vi } from "vitest";

// Task 4-c item S7: migrateLocalCacheToIdb removed localStorage keys while
// iterating by INDEX, so every other matching key was skipped each run
// (indices shift on each removeItem). The fix snapshots the matching keys
// before removing, so all matching keys migrate exactly once.

// In-memory fake of the cacheDb module (no real IndexedDB in node).
vi.mock("../../src/utils/cacheDb.js", () => {
  const store = new Map();
  return {
    CACHE_STORES: {
      chatList: "chatList",
      messages: "messages",
      index: "messagesIndex",
      channelSeen: "channelSeen",
      mediaThumbs: "mediaThumbs",
      mediaPosters: "mediaPosters",
      voiceWaveforms: "voiceWaveforms",
    },
    idbClearStore: vi.fn(async () => {
      store.clear();
    }),
    idbDelete: vi.fn(async (s, k) => {
      store.delete(`${s}::${k}`);
      return true;
    }),
    idbGet: vi.fn(async (s, k) => store.get(`${s}::${k}`) ?? null),
    idbSet: vi.fn(async (s, k, v) => {
      store.set(`${s}::${k}`, { data: v });
      return true;
    }),
    isIdbAvailable: vi.fn(() => true),
  };
});

import { idbSet } from "../../src/utils/cacheDb.js";
import {
  CHAT_CACHE_VERSION,
  CHAT_MESSAGES_CACHE_KEY,
  CHANNEL_SEEN_CACHE_KEY,
  migrateLocalCacheToIdb,
} from "../../src/utils/chatCache.js";

const backing = new Map();
const fakeLocalStorage = {
  get length() {
    return backing.size;
  },
  key(i) {
    return [...backing.keys()][i] ?? null;
  },
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => {
    backing.delete(k);
  },
};

beforeEach(() => {
  backing.clear();
  idbSet.mockClear();
  globalThis.window = { localStorage: fakeLocalStorage, indexedDB: {} };
});

describe("migrateLocalCacheToIdb — index-removal skip bug", () => {
  test("migrates 5 matching message-cache keys exactly once, each removed", async () => {
    const ids = ["a1", "b2", "c3", "d4", "e5"];
    ids.forEach((id) => {
      fakeLocalStorage.setItem(
        `${CHAT_MESSAGES_CACHE_KEY}:alice:${id}`,
        JSON.stringify({ version: CHAT_CACHE_VERSION, messages: [{ id }] }),
      );
    });
    // Non-matching keys must be left alone.
    fakeLocalStorage.setItem(
      `${CHAT_MESSAGES_CACHE_KEY}:bob:a1`,
      JSON.stringify({ version: CHAT_CACHE_VERSION, messages: [] }),
    );
    fakeLocalStorage.setItem("unrelated", JSON.stringify({ keep: true }));

    await migrateLocalCacheToIdb("alice");

    const migratedKeys = idbSet.mock.calls
      .filter(([storeName]) => storeName === "messages")
      .map(([, key]) => key);
    expect(migratedKeys.sort()).toEqual(
      ids
        .map((id) => `${CHAT_MESSAGES_CACHE_KEY}:alice:${id}`)
        .sort(),
    );
    // Exactly once each — no duplicates from re-visiting shifted indices.
    expect(new Set(migratedKeys).size).toBe(5);
    // Every migrated key removed; bob's key untouched.
    ids.forEach((id) => {
      expect(
        fakeLocalStorage.getItem(`${CHAT_MESSAGES_CACHE_KEY}:alice:${id}`),
      ).toBeNull();
    });
    expect(
      fakeLocalStorage.getItem(`${CHAT_MESSAGES_CACHE_KEY}:bob:a1`),
    ).not.toBeNull();
    expect(fakeLocalStorage.getItem("unrelated")).not.toBeNull();
  });

  test("migrates every matching channel-seen key exactly once", async () => {
    const ids = ["c1", "c2", "c3", "c4", "c5", "c6"];
    ids.forEach((id) => {
      fakeLocalStorage.setItem(
        `${CHANNEL_SEEN_CACHE_KEY}:alice:${id}`,
        JSON.stringify({ version: 1, counts: { [id]: 2 } }),
      );
    });

    await migrateLocalCacheToIdb("alice");

    const migratedKeys = idbSet.mock.calls
      .filter(([storeName]) => storeName === "channelSeen")
      .map(([, key]) => key);
    expect(new Set(migratedKeys).size).toBe(6);
    ids.forEach((id) => {
      expect(
        fakeLocalStorage.getItem(`${CHANNEL_SEEN_CACHE_KEY}:alice:${id}`),
      ).toBeNull();
    });
  });

  test("a second run is a no-op (nothing left behind to migrate)", async () => {
    const ids = ["a1", "b2", "c3", "d4", "e5"];
    ids.forEach((id) => {
      fakeLocalStorage.setItem(
        `${CHAT_MESSAGES_CACHE_KEY}:alice:${id}`,
        JSON.stringify({ version: CHAT_CACHE_VERSION, messages: [] }),
      );
    });

    await migrateLocalCacheToIdb("alice");
    expect(idbSet.mock.calls.filter(([s]) => s === "messages").length).toBe(5);

    await migrateLocalCacheToIdb("alice");
    expect(idbSet.mock.calls.filter(([s]) => s === "messages").length).toBe(5);
  });
});
