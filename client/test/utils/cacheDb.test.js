import { describe, test, expect, beforeEach, vi } from "vitest";

// cacheDb keeps a module-level dbPromise, so each test gets a fresh module
// instance plus a fresh fake `window.indexedDB` it can drive manually.
let cacheDb;

function makeOpenController({ transactionThrows = false, storeValue = null } = {}) {
  const controller = {
    request: null,
    db: null,
    openCount: 0,
  };
  const fakeDb = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    closed: false,
    close() {
      this.closed = true;
    },
    transaction() {
      if (transactionThrows) {
        // Mirrors the InvalidStateError a closed connection throws.
        throw new Error("InvalidStateError: connection is closed");
      }
      const request = {
        result: storeValue,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      const tx = {
        objectStore: () => ({
          get: () => request,
          getAll: () => request,
          put() {},
          delete() {},
          clear() {},
        }),
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  controller.db = fakeDb;
  return { controller, fakeDb };
}

function installFakeIndexedDB({ controller, fakeDb }) {
  const fakeIdb = {
    open(_name, _version) {
      controller.openCount += 1;
      const request = {
        result: fakeDb,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      controller.request = request;
      return request;
    },
  };
  globalThis.window = { indexedDB: fakeIdb };
}

beforeEach(async () => {
  vi.resetModules();
  globalThis.window = undefined;
  cacheDb = await import("../../src/utils/cacheDb.js");
});

describe("cacheDb — failed open is not cached permanently", () => {
  test("retries the open on the next call after a failed open", async () => {
    const { controller, fakeDb } = makeOpenController();
    installFakeIndexedDB({ controller, fakeDb });

    const first = cacheDb.idbGet("chatList", "k");
    controller.request.onerror();
    await expect(first).resolves.toBeNull();
    expect(controller.openCount).toBe(1);

    const second = cacheDb.idbGet("chatList", "k");
    controller.request.onsuccess?.();
    await expect(second).resolves.toBeNull(); // store.get result is null here
    expect(controller.openCount).toBe(2); // reopened instead of cached null
  });
});

describe("cacheDb — blocked open does not hang forever", () => {
  test("resolves null when another tab blocks the version bump", async () => {
    const { controller, fakeDb } = makeOpenController();
    installFakeIndexedDB({ controller, fakeDb });

    const pending = cacheDb.idbGet("chatList", "k");
    controller.request.onblocked();
    await expect(pending).resolves.toBeNull();

    // The blocked open must not be cached: next call retries.
    const retry = cacheDb.idbGet("chatList", "k");
    controller.request.onsuccess?.();
    await expect(retry).resolves.toBeNull();
    expect(controller.openCount).toBe(2);
  });
});

describe("cacheDb — stale connections are reset", () => {
  test("onversionchange closes the db and the next call reopens", async () => {
    const { controller, fakeDb } = makeOpenController();
    installFakeIndexedDB({ controller, fakeDb });

    const first = cacheDb.idbGet("chatList", "k");
    controller.request.onsuccess();
    await expect(first).resolves.toBeNull();
    expect(controller.openCount).toBe(1);

    fakeDb.onversionchange();
    expect(fakeDb.closed).toBe(true);

    const second = cacheDb.idbGet("chatList", "k");
    controller.request.onsuccess();
    await expect(second).resolves.toBeNull();
    expect(controller.openCount).toBe(2);
  });

  test("onclose resets the cached connection", async () => {
    const { controller, fakeDb } = makeOpenController();
    installFakeIndexedDB({ controller, fakeDb });

    const first = cacheDb.idbGet("chatList", "k");
    controller.request.onsuccess();
    await expect(first).resolves.toBeNull();

    fakeDb.onclose();

    const second = cacheDb.idbGet("chatList", "k");
    controller.request.onsuccess();
    await expect(second).resolves.toBeNull();
    expect(controller.openCount).toBe(2);
  });

  test("a db.transaction throw resolves null instead of throwing (void callers)", async () => {
    const { controller, fakeDb } = makeOpenController({ transactionThrows: true });
    installFakeIndexedDB({ controller, fakeDb });

    const first = cacheDb.idbGet("chatList", "k");
    controller.request.onsuccess();
    await expect(first).resolves.toBeNull();

    // The stale connection was dropped: the next call opens again.
    const { controller: controller2, fakeDb: fakeDb2 } = makeOpenController();
    installFakeIndexedDB({ controller: controller2, fakeDb: fakeDb2 });
    const second = cacheDb.idbGet("chatList", "k");
    controller2.request.onsuccess();
    await expect(second).resolves.toBeNull();
    expect(controller2.openCount).toBe(1);
  });
});

describe("cacheDb — happy path still works", () => {
  test("idbGet returns the stored value through the fake store", async () => {
    const payload = { data: { messages: [1, 2, 3] }, updatedAt: 1 };
    const { controller, fakeDb } = makeOpenController({ storeValue: payload });
    installFakeIndexedDB({ controller, fakeDb });

    const result = cacheDb.idbGet("messages", "user:chat");
    controller.request.onsuccess();
    await expect(result).resolves.toEqual(payload);
    expect(controller.openCount).toBe(1);
  });

  test("without window.indexedDB every helper resolves null", async () => {
    globalThis.window = {};
    await expect(cacheDb.idbGet("chatList", "k")).resolves.toBeNull();
    await expect(cacheDb.idbSet("chatList", "k", { a: 1 })).resolves.toBeNull();
  });
});
