import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Task 4-c item S4: ensurePushSubscription used to depend on the whole `user`
// object and on messagePreviewEnabled, so the auto-ensure effect (which runs
// on every identity change) performed a full key fetch + subscribe POST
// outside the 2-minute debounce on every preview toggle / user-object
// refresh. The fix narrows the deps to the stable identity (user?.username)
// and reads the preview flag through a ref (the explicit preview-toggle path
// still passes { messagePreview: next } so the payload stays correct).

const source = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/hooks/chat/useChatNotifications.js",
  ),
  "utf8",
);

// Extract every `}, [ ... ]);` dependency array from the hook body.
const depArrays = [...source.matchAll(/\}, \[([\s\S]*?)\]\);/g)].map((m) => m[1]);

describe("useChatNotifications — narrowed push subscription deps", () => {
  test("ensurePushSubscription deps use the stable identity, not the user object", () => {
    const ensureDeps = depArrays.find((deps) =>
      deps.includes("fetchPushPublicKey"),
    );
    expect(ensureDeps).toBeDefined();
    // pushUsername is the pinned `user?.username` identity variable; the
    // React compiler infers a dependency on the whole user object for
    // `user?.username`, so the identity must be a plain variable instead.
    expect(ensureDeps).toContain("pushUsername");
    expect(source).toMatch(/const pushUsername = user\?\.username \?\? null;/);
    // The whole user object must no longer be a dependency.
    expect(ensureDeps).not.toMatch(/(^|[,\s])user,/);
  });

  test("ensurePushSubscription deps no longer include messagePreviewEnabled", () => {
    const ensureDeps = depArrays.find((deps) =>
      deps.includes("fetchPushPublicKey"),
    );
    expect(ensureDeps).not.toContain("messagePreviewEnabled");
  });

  test("preview flag is read through a ref mirror", () => {
    expect(source).toMatch(/messagePreviewEnabledRef\.current/);
    expect(source).toMatch(
      /messagePreview !== undefined\s*\?\s*messagePreview\s*:\s*messagePreviewEnabledRef\.current/,
    );
  });

  test("the ref mirror stays in sync with the state", () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*messagePreviewEnabledRef\.current = messagePreviewEnabled;\s*\}, \[messagePreviewEnabled\]\);/,
    );
  });

  test("the explicit preview-toggle path still passes the new value explicitly", () => {
    expect(source).toMatch(
      /await ensurePushSubscription\(\{ messagePreview: next \}\)/,
    );
  });

  test("the auto-ensure effect no longer re-runs on preview toggles", () => {
    // The effect with the setTimeout(0) auto-ensure must depend only on
    // ensurePushSubscription, notificationPermission, notificationsEnabled.
    const autoEnsureDeps = depArrays.find(
      (deps) =>
        deps.includes("ensurePushSubscription") &&
        deps.includes("notificationsEnabled") &&
        deps.split(",").length === 3,
    );
    expect(autoEnsureDeps).toBeDefined();
    expect(autoEnsureDeps).not.toContain("messagePreviewEnabled");
    expect(autoEnsureDeps).not.toContain("user");
  });
});
