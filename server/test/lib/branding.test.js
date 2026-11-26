import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  BRANDING_DEFAULTS,
  BRANDING_SETTING_KEY,
  BRANDING_ICON_SIZES,
  createBrandingService,
  isPngBuffer,
  normalizeBrandingPatch,
} from "../../lib/branding.js";

// A real 1×1 PNG (valid signature + IHDR + IDAT + IEND).
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("normalizeBrandingPatch", () => {
  test("accepts an empty patch", () => {
    const result = normalizeBrandingPatch({});
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
  });

  test("normalizes a valid full patch", () => {
    const result = normalizeBrandingPatch({
      aboutLinks: [{ icon: "website", href: "https://example.org" }],
      copyrightLabel: "  Acme Corp  ",
      copyrightHref: "https://acme.example",
      rightsText: "Custom sentence",
      loginTitle: "Acme Chat",
      loginTagline: "سازمان اکمه",
    });
    expect(result.ok).toBe(true);
    expect(result.value.aboutLinks).toEqual([
      { icon: "website", href: "https://example.org" },
    ]);
    expect(result.value.copyrightLabel).toBe("Acme Corp");
    expect(result.value.loginTitle).toBe("Acme Chat");
  });

  test("rejects unknown icons and unsafe URLs", () => {
    const bad = normalizeBrandingPatch({
      aboutLinks: [{ icon: "twitter", href: "https://x.com" }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/unknown link icon/i);

    const unsafe = normalizeBrandingPatch({
      aboutLinks: [{ icon: "website", href: "javascript:alert(1)" }],
    });
    expect(unsafe.ok).toBe(false);
    expect(unsafe.errors.join(" ")).toMatch(/http/i);
  });

  test("rejects more than the maximum number of links", () => {
    const links = Array.from({ length: 9 }, () => ({
      icon: "website",
      href: "https://example.org",
    }));
    const result = normalizeBrandingPatch({ aboutLinks: links });
    expect(result.ok).toBe(false);
  });

  test("mailto: links are allowed", () => {
    const result = normalizeBrandingPatch({
      aboutLinks: [{ icon: "email", href: "mailto:support@example.org" }],
    });
    expect(result.ok).toBe(true);
  });

  test("clamps overly long text fields", () => {
    const result = normalizeBrandingPatch({
      loginTitle: "x".repeat(500),
      rightsText: "y".repeat(1000),
    });
    expect(result.ok).toBe(true);
    expect(result.value.loginTitle.length).toBe(60);
    expect(result.value.rightsText.length).toBe(500);
  });

  test("accepts null/undefined raw input", () => {
    expect(normalizeBrandingPatch().ok).toBe(true);
    expect(normalizeBrandingPatch(undefined).ok).toBe(true);
  });
});

describe("isPngBuffer", () => {
  test("recognizes PNG signatures and rejects everything else", () => {
    expect(isPngBuffer(PNG_1PX)).toBe(true);
    expect(isPngBuffer(Buffer.from("<svg/>"))).toBe(false);
    expect(isPngBuffer(null)).toBe(false);
    expect(isPngBuffer("png")).toBe(false);
  });
});

describe("createBrandingService", () => {
  function makeService() {
    const store = new Map();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-branding-test-"));
    const service = createBrandingService({
      dbGetSetting: (key) => store.get(key) ?? null,
      dbSetSetting: (key, value) => {
        store.set(key, String(value));
      },
      fs,
      path,
      brandingDir: dir,
    });
    return { store, dir, service };
  }

  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns the defaults when nothing is stored (pre-1.7 parity)", async () => {
    const { service } = makeService();
    const config = await service.getConfig();
    expect(config.aboutLinks).toEqual(BRANDING_DEFAULTS.aboutLinks);
    expect(config.copyrightLabel).toBe("@MASolutionExpert");
    expect(config.rightsText).toBe("");
    expect(config.loginTitle).toBe("");
    expect(config.logo).toBeNull();
    expect(config.logoUpdatedAt).toBeNull();
  });

  test("updateConfig merges the patch and persists it in app_settings", async () => {
    const { store, service } = makeService();
    const config = await service.updateConfig({
      loginTitle: "Acme",
      aboutLinks: [{ icon: "website", href: "https://acme.example" }],
    });
    expect(config.loginTitle).toBe("Acme");
    // Unspecified fields keep their defaults:
    expect(config.copyrightLabel).toBe(BRANDING_DEFAULTS.copyrightLabel);
    const stored = JSON.parse(store.get(BRANDING_SETTING_KEY));
    expect(stored.loginTitle).toBe("Acme");
    expect(stored.logoUpdatedAt).toBeNull(); // config writes never touch the logo flag
  });

  test("a corrupt stored blob falls back to the defaults", async () => {
    const { store, service } = makeService();
    store.set(BRANDING_SETTING_KEY, "{not json");
    const config = await service.getConfig();
    expect(config.aboutLinks).toEqual(BRANDING_DEFAULTS.aboutLinks);
  });

  test("saveLogoFiles writes PNGs, flips logoUpdatedAt and enables public URLs", async () => {
    const { service } = makeService();
    const fileMap = Object.fromEntries(
      BRANDING_ICON_SIZES.map((size) => [size, PNG_1PX]),
    );
    const result = await service.saveLogoFiles(fileMap);
    expect(result.logoUpdatedAt).toBeTruthy();
    expect(result.logo.logoUrl).toBe("/api/branding/logo.png");
    expect(result.logo.faviconUrl).toBe("/api/branding/icon-32.png");
    // Files actually on disk:
    expect(service.readIcon(512)).toBeTruthy();
    expect(service.readIcon(16)).toBeTruthy();
    expect(service.hasCustomLogo()).toBe(true);
  });

  test("saveLogoFiles requires at least the 512 and 192 icons", async () => {
    const { service } = makeService();
    await expect(service.saveLogoFiles({ 32: PNG_1PX })).rejects.toThrow(/icon-512/i);
    await expect(service.saveLogoFiles({})).rejects.toThrow(/icon-512/i);
  });

  test("saveLogoFiles rejects non-PNG payloads", async () => {
    const { service } = makeService();
    await expect(
      service.saveLogoFiles({ 512: Buffer.from("not a png"), 192: PNG_1PX }),
    ).rejects.toThrow(/PNG/i);
  });

  test("readIcon rejects sizes outside the registry", () => {
    const { service } = makeService();
    expect(service.readIcon(64)).toBeNull();
    expect(service.readIcon("512")).toBeNull(); // nothing stored yet → null anyway
  });

  test("resetLogo removes the files and clears the flag", async () => {
    const { dir, service } = makeService();
    await service.saveLogoFiles(Object.fromEntries(
      BRANDING_ICON_SIZES.map((size) => [size, PNG_1PX]),
    ));
    expect(service.hasCustomLogo()).toBe(true);
    const after = await service.resetLogo();
    expect(after.logoUpdatedAt).toBeNull();
    expect(after.logo).toBeNull();
    expect(service.hasCustomLogo()).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("buildManifest returns null without a custom logo and the org name with one", async () => {
    const { service } = makeService();
    expect(await service.buildManifest()).toBeNull();
    await service.updateConfig({ loginTitle: "Acme" });
    await service.saveLogoFiles(Object.fromEntries(
      BRANDING_ICON_SIZES.map((size) => [size, PNG_1PX]),
    ));
    const manifest = await service.buildManifest();
    expect(manifest.name).toBe("Acme");
    expect(manifest.short_name).toBe("Acme");
    expect(manifest.icons.some((i) => i.src === "/api/branding/icon-512.png")).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });
});
