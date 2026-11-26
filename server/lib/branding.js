// ─── Branding / personalization (1.7.0-dev.2) ────────────────────────────────
//
// Lets the instance owner personalize the "About" dialog and the entry page:
//   • About dialog: configurable link icons (website/github/docker/telegram/
//     email/...), an editable copyright line and an editable proprietary-
//     software sentence. The app version stays on top and is never editable.
//   • Entry page: an uploaded organization logo (used as favicon, apple-touch
//     icon and PWA app icon) plus an editable title/tagline.
//
// Design notes:
//   • The config is a single JSON blob in the existing `app_settings` KV table
//     (migration 032) under the key below — no new migration is required and
//     future fields added to the registry keep working (normalize() merges
//     unknown/missing fields back to defaults).
//   • Logo files are pre-sized PNGs produced client-side (canvas) from ANY
//     image format the browser can decode, stored plain under DATA_DIR
//     (public assets, not user content, so they are not encrypted at rest)
//     and served by public /api/branding/* routes. The server therefore has
//     NO native image dependency (no sharp) — it only stores and serves.
//   • The server-registry defaults reproduce exactly the pre-1.7.0 hard-coded
//     About dialog (GitHub + Docker links, @MASolutionExpert copyright), so
//     unconfigured instances look unchanged.

export const BRANDING_SETTING_KEY = "branding.config";

// Icon keys a configurable About link may use. `website` renders the generic
// globe icon — the replacement the owner asked for instead of GitHub/Docker.
export const BRANDING_ICON_KEYS = [
  "website",
  "github",
  "docker",
  "telegram",
  "email",
  "railway",
  "chatdesk",
];

// PNG sizes the client generates and this module stores/serves.
export const BRANDING_ICON_SIZES = [16, 32, 180, 192, 512];

export const BRANDING_MAX_LINKS = 8;

export const BRANDING_DEFAULTS = Object.freeze({
  // Same socials the About dialog shipped before personalization existed.
  aboutLinks: Object.freeze([
    Object.freeze({
      icon: "docker",
      href: "https://hub.docker.com/r/MASolutionExpert/chatdesk",
    }),
    Object.freeze({
      icon: "github",
      href: "https://github.com/MASolutionExpert/chatdesk",
    }),
  ]),
  copyrightLabel: "@MASolutionExpert",
  copyrightHref: "https://github.com/MASolutionExpert",
  // Empty string = the current calendar year is rendered dynamically.
  // The owner can pin or replace the «©2026» token with any short text.
  copyrightYear: "",
  // Empty string = fall back to the UI-language default sentence
  // (settings.about.rights). The owner can override it per instance.
  rightsText: "",
  // Empty string = fall back to the "ChatDesk" wordmark on the entry page.
  loginTitle: "",
  loginTagline: "",
  logoUpdatedAt: null,
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isSafeUrl(value) {
  const url = String(value || "").trim();
  if (!url) return false;
  return /^(https?:\/\/|mailto:)/i.test(url);
}

function clampText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

// Validates and normalizes a partial branding patch. Unknown keys are
// dropped; missing keys keep their current/default value at merge time.
// Returns { ok, value, errors } — `value` holds only the normalized keys
// present in the patch (suitable for merging into the stored config).
export function normalizeBrandingPatch(raw = {}) {
  const errors = [];
  const value = {};

  if (raw.aboutLinks !== undefined) {
    if (!Array.isArray(raw.aboutLinks)) {
      errors.push("'aboutLinks' must be an array.");
    } else if (raw.aboutLinks.length > BRANDING_MAX_LINKS) {
      errors.push(`A maximum of ${BRANDING_MAX_LINKS} links is allowed.`);
    } else {
      const links = [];
      for (const item of raw.aboutLinks) {
        const icon = String(item?.icon || "").trim();
        const href = String(item?.href || "").trim();
        if (!BRANDING_ICON_KEYS.includes(icon)) {
          errors.push(`Unknown link icon '${icon}'.`);
          continue;
        }
        if (!isSafeUrl(href)) {
          errors.push("Link URLs must start with http://, https:// or mailto:.");
          continue;
        }
        links.push({ icon, href });
      }
      if (!errors.length) value.aboutLinks = links;
    }
  }

  if (raw.copyrightLabel !== undefined) {
    value.copyrightLabel = clampText(raw.copyrightLabel, 120);
  }
  if (raw.copyrightYear !== undefined) {
    value.copyrightYear = clampText(raw.copyrightYear, 24);
  }
  if (raw.copyrightHref !== undefined) {
    const href = String(raw.copyrightHref || "").trim();
    if (href && !isSafeUrl(href)) {
      errors.push("The copyright URL must start with http://, https:// or mailto:.");
    } else {
      value.copyrightHref = href;
    }
  }
  if (raw.rightsText !== undefined) {
    value.rightsText = clampText(raw.rightsText, 500);
  }
  if (raw.loginTitle !== undefined) {
    value.loginTitle = clampText(raw.loginTitle, 60);
  }
  if (raw.loginTagline !== undefined) {
    value.loginTagline = clampText(raw.loginTagline, 120);
  }

  if (errors.length) return { ok: false, value: null, errors };
  return { ok: true, value, errors };
}

export function isPngBuffer(buffer) {
  return Boolean(
    buffer &&
      Buffer.isBuffer(buffer) &&
      buffer.length >= PNG_SIGNATURE.length &&
      PNG_SIGNATURE.compare(buffer, 0, PNG_SIGNATURE.length) === 0,
  );
}

export function createBrandingService({
  dbGetSetting,
  dbSetSetting,
  fs = null,
  path: nodePath = null,
  brandingDir = null,
}) {
  if (typeof dbGetSetting !== "function" || typeof dbSetSetting !== "function") {
    throw new Error("createBrandingService requires dbGetSetting and dbSetSetting.");
  }

  const iconFileName = (size) => `icon-${size}.png`;

  const ensureDir = () => {
    if (!fs || !nodePath || !brandingDir) return false;
    try {
      fs.mkdirSync(brandingDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  };

  // Merges a stored JSON blob over the defaults. Corrupt/legacy payloads fall
  // back to the defaults instead of crashing every request.
  const mergeConfig = (stored) => {
    let parsed = {};
    if (stored) {
      try {
        const candidate = JSON.parse(stored);
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          parsed = candidate;
        }
      } catch {
        parsed = {};
      }
    }
    const merged = { ...BRANDING_DEFAULTS };
    for (const key of Object.keys(BRANDING_DEFAULTS)) {
      if (parsed[key] !== undefined && parsed[key] !== null) {
        merged[key] = parsed[key];
      }
    }
    // aboutLinks must be a well-formed list even if the DB row was tampered with.
    if (!Array.isArray(merged.aboutLinks)) {
      merged.aboutLinks = [...BRANDING_DEFAULTS.aboutLinks];
    } else {
      merged.aboutLinks = merged.aboutLinks
        .filter(
          (link) =>
            link &&
            BRANDING_ICON_KEYS.includes(link.icon) &&
            isSafeUrl(link.href),
        )
        .slice(0, BRANDING_MAX_LINKS);
    }
    return merged;
  };

  const hasCustomLogo = () => {
    if (!fs || !nodePath || !brandingDir) return false;
    try {
      return fs.existsSync(nodePath.join(brandingDir, iconFileName(512)));
    } catch {
      return false;
    }
  };

  const readIcon = (size) => {
    if (!fs || !nodePath || !brandingDir) return null;
    if (!BRANDING_ICON_SIZES.includes(Number(size))) return null;
    try {
      const file = nodePath.join(brandingDir, iconFileName(size));
      if (!fs.existsSync(file)) return null;
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  };

  // Cache-busting version for every branding URL. Derived from the stored
  // logoUpdatedAt timestamp so each upload produces a NEW set of URLs — this
  // is what makes a replaced logo appear everywhere immediately instead of
  // the browser/proxy serving the previous PNG for minutes. When the setting
  // is missing but files exist on disk, the icon-512 mtime is used instead,
  // so the URLs still change whenever the files are swapped.
  const logoVersion = (storedUpdatedAt) => {
    const raw = String(storedUpdatedAt || "").trim();
    if (raw) {
      const ts = Date.parse(raw);
      if (Number.isFinite(ts)) return String(ts);
      return raw.replace(/[^0-9a-z_-]/gi, "").slice(0, 40) || "logo";
    }
    try {
      return String(Math.floor(fs.statSync(nodePath.join(brandingDir, iconFileName(512))).mtimeMs));
    } catch {
      return "";
    }
  };

  const withVersion = (url, version) =>
    version ? `${url}?v=${encodeURIComponent(version)}` : url;

  const publicUrls = (version) => {
    if (!hasCustomLogo()) return null;
    return {
      logoUrl: withVersion("/api/branding/logo.png", version),
      faviconUrl: withVersion("/api/branding/icon-32.png", version),
      appleIconUrl: withVersion("/api/branding/icon-180.png", version),
      icon16Url: withVersion("/api/branding/icon-16.png", version),
      icon32Url: withVersion("/api/branding/icon-32.png", version),
      icon180Url: withVersion("/api/branding/icon-180.png", version),
      icon192Url: withVersion("/api/branding/icon-192.png", version),
      icon512Url: withVersion("/api/branding/icon-512.png", version),
    };
  };

  const configWithLogo = (config) => ({
    ...config,
    logo: publicUrls(logoVersion(config.logoUpdatedAt)),
  });

  return {
    // Full effective config (defaults + stored overrides) with public URLs.
    async getConfig() {
      const stored = await Promise.resolve(dbGetSetting(BRANDING_SETTING_KEY));
      return configWithLogo(mergeConfig(stored));
    },

    // Merges a normalized patch into the stored config and persists it.
    async updateConfig(patch) {
      const stored = await Promise.resolve(dbGetSetting(BRANDING_SETTING_KEY));
      const current = mergeConfig(stored);
      const next = { ...current, ...patch, logoUpdatedAt: current.logoUpdatedAt };
      dbSetSetting(BRANDING_SETTING_KEY, JSON.stringify(next));
      return configWithLogo(next);
    },

    // Writes a map { <size>: Buffer } of PNGs and marks the custom logo active.
    async saveLogoFiles(fileMap = {}) {
      if (!ensureDir()) {
        throw new Error("Branding storage directory is not available.");
      }
      const required = [512, 192];
      for (const size of required) {
        if (!isPngBuffer(fileMap[size])) {
          throw new Error(`A valid PNG file for icon-${size} is required.`);
        }
      }
      const written = [];
      for (const size of BRANDING_ICON_SIZES) {
        const buffer = fileMap[size];
        if (!buffer) continue;
        if (!isPngBuffer(buffer)) {
          throw new Error(`icon-${size} must be a PNG file.`);
        }
        fs.writeFileSync(nodePath.join(brandingDir, iconFileName(size)), buffer);
        written.push(size);
      }
      const stored = await Promise.resolve(dbGetSetting(BRANDING_SETTING_KEY));
      const current = mergeConfig(stored);
      const next = { ...current, logoUpdatedAt: new Date().toISOString() };
      dbSetSetting(BRANDING_SETTING_KEY, JSON.stringify(next));
      return { ...configWithLogo(next), written };
    },

    // Removes the custom logo files and falls back to the bundled ChatDesk art.
    async resetLogo() {
      if (fs && nodePath && brandingDir) {
        for (const size of BRANDING_ICON_SIZES) {
          try {
            const file = nodePath.join(brandingDir, iconFileName(size));
            if (fs.existsSync(file)) fs.unlinkSync(file);
          } catch {
            // Best effort — a stale file that cannot be removed must not
            // block resetting the config flag.
          }
        }
      }
      const stored = await Promise.resolve(dbGetSetting(BRANDING_SETTING_KEY));
      const current = mergeConfig(stored);
      const next = { ...current, logoUpdatedAt: null };
      dbSetSetting(BRANDING_SETTING_KEY, JSON.stringify(next));
      return { ...next, logo: null };
    },

    hasCustomLogo,
    readIcon,

    // A dynamic PWA manifest when a custom logo exists; `null` means "serve
    // the bundled dist manifest" (caller falls through to express.static).
    async buildManifest() {
      if (!hasCustomLogo()) return null;
      const stored = await Promise.resolve(dbGetSetting(BRANDING_SETTING_KEY));
      const config = mergeConfig(stored);
      // Versioned icon URLs — when the owner uploads a new logo the manifest
      // points at fresh URLs, so installed PWAs pick the new art on update.
      const version = logoVersion(config.logoUpdatedAt);
      const iconSrc = (size) => withVersion(`/api/branding/icon-${size}.png`, version);
      const name = config.loginTitle || "ChatDesk";
      return {
        name,
        short_name: name,
        description: "ChatDesk chat",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#10b981",
        icons: [
          { src: iconSrc(192), sizes: "192x192", type: "image/png" },
          { src: iconSrc(512), sizes: "512x512", type: "image/png" },
          {
            src: iconSrc(192),
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: iconSrc(512),
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      };
    },
  };
}
