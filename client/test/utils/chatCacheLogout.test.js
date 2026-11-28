import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as chatCache from "../../src/utils/chatCache.js";
import * as cacheDb from "../../src/utils/cacheDb.js";
import { CACHE_STORES } from "../../src/utils/cacheDb.js";
import {
  CHAT_MESSAGES_CACHE_KEY,
  MEDIA_THUMB_CACHE_KEY,
  MEDIA_POSTER_CACHE_KEY,
  VOICE_WAVEFORM_CACHE_KEY,
} from "../../src/utils/chatCache.js";

// Logout must leave no readable trace of the previous user's chats:
// per-user localStorage keys, shared media caches and every IndexedDB store.
// Mirrors the stubbing conventions of chatCacheOffline.test.js.
describe("clearAllChatCaches (logout privacy cleanup)", () => {
  let localStorageMap;
  let sessionStorageMap;

  const makeStorage = (map) => ({
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
  });

  beforeEach(() => {
    localStorageMap = new Map();
    sessionStorageMap = new Map();
    vi.stubGlobal("window", {
      indexedDB: {},
      localStorage: makeStorage(localStorageMap),
      sessionStorage: makeStorage(sessionStorageMap),
    });
    vi.spyOn(cacheDb, "isIdbAvailable").mockReturnValue(true);
    vi.spyOn(chatCache, "canUseIdb").mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const seedUserCaches = (username) => {
    localStorageMap.set(chatCache.buildChatListCacheKey(username), "{}");
    localStorageMap.set(chatCache.buildMessagesIndexKey(username), "[]");
    localStorageMap.set(`${CHAT_MESSAGES_CACHE_KEY}:${username}:chat-1`, "[]");
    localStorageMap.set(`${CHAT_MESSAGES_CACHE_KEY}:${username}:chat-2`, "[]");
    localStorageMap.set("some-unrelated-key", "keep-me");
  };

  const seedSharedMediaCaches = () => {
    localStorageMap.set(MEDIA_THUMB_CACHE_KEY, "{}");
    localStorageMap.set("chat-media-thumbs", "{}"); // legacy key
    localStorageMap.set(MEDIA_POSTER_CACHE_KEY, "{}");
    localStorageMap.set("chat-video-posters-v2", "{}"); // legacy key
    localStorageMap.set(VOICE_WAVEFORM_CACHE_KEY, "{}");
    sessionStorageMap.set(MEDIA_THUMB_CACHE_KEY, "{}");
    sessionStorageMap.set("chat-video-posters-v2", "{}");
  };

  test("removes per-user localStorage keys, shared media caches and all IDB stores", async () => {
    const username = "alice";
    seedUserCaches(username);
    seedSharedMediaCaches();

    const clearedStores = [];
    vi.spyOn(cacheDb, "idbClearStore").mockImplementation(async (store) => {
      clearedStores.push(store);
      return true;
    });

    await chatCache.clearAllChatCaches(username);

    expect(localStorageMap.has(chatCache.buildChatListCacheKey(username))).toBe(
      false,
    );
    expect(localStorageMap.has(chatCache.buildMessagesIndexKey(username))).toBe(
      false,
    );
    expect(
      localStorageMap.has(`${CHAT_MESSAGES_CACHE_KEY}:${username}:chat-1`),
    ).toBe(false);
    expect(
      localStorageMap.has(`${CHAT_MESSAGES_CACHE_KEY}:${username}:chat-2`),
    ).toBe(false);
    // Unrelated keys (theme, session, ...) must survive.
    expect(localStorageMap.get("some-unrelated-key")).toBe("keep-me");

    for (const key of [
      MEDIA_THUMB_CACHE_KEY,
      "chat-media-thumbs",
      MEDIA_POSTER_CACHE_KEY,
      "chat-video-posters-v2",
      VOICE_WAVEFORM_CACHE_KEY,
    ]) {
      expect(localStorageMap.has(key)).toBe(false);
    }
    expect(sessionStorageMap.has(MEDIA_THUMB_CACHE_KEY)).toBe(false);
    expect(sessionStorageMap.has("chat-video-posters-v2")).toBe(false);

    expect(clearedStores.sort()).toEqual(Object.values(CACHE_STORES).sort());
  });

  test("still clears shared media caches and IDB stores without a username", async () => {
    seedSharedMediaCaches();
    const clearedStores = [];
    vi.spyOn(cacheDb, "idbClearStore").mockImplementation(async (store) => {
      clearedStores.push(store);
      return true;
    });

    await chatCache.clearAllChatCaches("");

    expect(localStorageMap.has(MEDIA_THUMB_CACHE_KEY)).toBe(false);
    expect(clearedStores).toEqual(Object.values(CACHE_STORES));
  });

  test("degrades to a no-op without window/localStorage/IDB", async () => {
    vi.unstubAllGlobals();
    const clearedStores = [];
    vi.spyOn(cacheDb, "idbClearStore").mockImplementation(async (store) => {
      clearedStores.push(store);
      return true;
    });

    await expect(
      chatCache.clearAllChatCaches("bob"),
    ).resolves.toBeUndefined();
    expect(clearedStores).toEqual([]);
  });

  test("does not touch other users' localStorage entries", async () => {
    seedUserCaches("alice");
    seedUserCaches("mallory");

    vi.spyOn(cacheDb, "idbClearStore").mockResolvedValue(true);

    await chatCache.clearAllChatCaches("alice");

    expect(
      localStorageMap.has(`${CHAT_MESSAGES_CACHE_KEY}:mallory:chat-1`),
    ).toBe(true);
    expect(
      localStorageMap.has(chatCache.buildChatListCacheKey("mallory")),
    ).toBe(true);
  });
});
