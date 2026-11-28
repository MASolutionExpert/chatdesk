import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteSwCacheVersion } from "../../vite.config.js";

const swSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/sw.js"),
  "utf8",
);

// Task 4-c item 1: the service worker must get a per-build CACHE_VERSION (so
// old hashed bundles are pruned on each deploy), must only post
// APP_SHELL_UPDATED when index.html actually changed, and must never leave a
// cache.put rejection unhandled. sw.js is a classic worker script, so these
// tests assert the source contract (the pragmatic approach agreed for this
// stage) plus the pure build-rewrite helper.
describe("sw.js cache version placeholder", () => {
  test("keeps a literal CACHE_VERSION placeholder the build can rewrite", () => {
    expect(swSource).toMatch(/const CACHE_VERSION = "[^"]*";/);
    // CACHE_NAME must derive from CACHE_VERSION so a per-build rewrite gives
    // a per-build cache name (and the activate prune actually fires).
    expect(swSource).toMatch(/const CACHE_NAME = `chatdesk-\$\{CACHE_VERSION\}`;/);
  });

  test("activate prunes every other chatdesk-* cache", () => {
    expect(swSource).toMatch(
      /key\.startsWith\("chatdesk-"\) && key !== CACHE_NAME/,
    );
  });
});

describe("sw.js cache.put safety", () => {
  test("every cache.put call has a .catch(() => null) attached", () => {
    const puts = swSource.match(/cache\.put\(/g) || [];
    expect(puts.length).toBeGreaterThanOrEqual(2);
    const guarded = swSource.match(
      /cache\.put\([^;]*?\)\s*\.catch\(\(\) => null\)/g,
    ) || [];
    expect(guarded.length).toBe(puts.length);
  });

  test("navigation puts are awaited via event.waitUntil and skip non-200", () => {
    expect(swSource).toMatch(
      /event\.waitUntil\(\s*cache\.put\("\/index\.html", response\.clone\(\)\)\.catch/,
    );
    expect(swSource.match(/response\.status === 200/g)?.length).toBe(2);
  });
});

describe("sw.js APP_SHELL_UPDATED signature gating", () => {
  test("keeps a last-index signature that starts as null", () => {
    expect(swSource).toMatch(/let lastIndexSignature = null;/);
  });

  test("posts APP_SHELL_UPDATED only when the index signature changed", () => {
    // The postMessage call must sit behind a guard that requires a non-null
    // previous signature AND a different new one (first load after
    // install/activate → no post; unchanged deploy → no post).
    expect(swSource).toMatch(
      /signature &&\s*lastIndexSignature !== null &&\s*signature !== lastIndexSignature/,
    );
    // The signature is etag || last-modified.
    expect(swSource).toMatch(
      /headers\?\.get\("etag"\) \|\| response\?\.headers\?\.get\("last-modified"\)/,
    );
    // A changed signature is stored for the next navigation.
    expect(swSource).toMatch(/if \(signature\) lastIndexSignature = signature;/);
  });
});

describe("rewriteSwCacheVersion (build plugin transform)", () => {
  test("rewrites the literal CACHE_VERSION with the build version", () => {
    const next = rewriteSwCacheVersion(
      'const CACHE_VERSION = "1.1.0";\nconst CACHE_NAME = `chatdesk-${CACHE_VERSION}`;',
      "20250101000000-abc123",
    );
    expect(next).toBe(
      'const CACHE_VERSION = "20250101000000-abc123";\nconst CACHE_NAME = `chatdesk-${CACHE_VERSION}`;',
    );
  });

  test("strips quotes and backslashes from the injected value", () => {
    const next = rewriteSwCacheVersion(
      'const CACHE_VERSION = "1.1.0";',
      'evil"\\value',
    );
    expect(next).toBe('const CACHE_VERSION = "evilvalue";');
  });

  test("returns null when the placeholder is missing (no rewrite)", () => {
    expect(rewriteSwCacheVersion("const OTHER = 1;", "v2")).toBeNull();
    expect(rewriteSwCacheVersion('const CACHE_VERSION = "1.1.0";', "")).toBeNull();
    expect(rewriteSwCacheVersion('const CACHE_VERSION = "1.1.0";', null)).toBeNull();
  });

  test("leaves everything after the placeholder untouched", () => {
    const source = 'const CACHE_VERSION = "1.1.0";\nself.addEventListener("fetch", () => {});';
    const next = rewriteSwCacheVersion(source, "build-1");
    expect(next).toBe(
      'const CACHE_VERSION = "build-1";\nself.addEventListener("fetch", () => {});',
    );
  });
});
