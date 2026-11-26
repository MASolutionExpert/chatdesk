// ─── Branding client cache (1.7.0-dev.2) ──────────────────────────────────────
//
// One shared fetch of the public /api/branding payload, reused by the entry
// page header (App.jsx), the About settings panel and the admin tab. Also
// swaps the favicon/apple-touch-icon link tags so the organization logo shows
// in the browser tab immediately — even before logging in.

import { apiFetch } from "../api/chatApi.js";

let cachePromise = null;
let cachedBranding = null;

function setLinkHref(selector, href) {
  const link = document.querySelector(selector);
  if (link && href) link.setAttribute("href", href);
}

export function getCachedBranding() {
  return cachedBranding;
}

export function loadBranding({ force = false } = {}) {
  if (cachedBranding && !force) return Promise.resolve(cachedBranding);
  if (cachePromise && !force) return cachePromise;
  cachePromise = (async () => {
    try {
      const response = await apiFetch("/api/branding");
      if (!response.ok) return null;
      const payload = await response.json();
      cachedBranding = payload;
      applyBrandingToDocument(payload);
      return payload;
    } catch {
      return null;
    } finally {
      cachePromise = null;
    }
  })();
  return cachePromise;
}

// Rewrites the favicon / apple-touch-icon <link> tags when the instance has a
// custom logo. Without one, the bundled static icons stay untouched.
export function applyBrandingToDocument(branding) {
  if (typeof document === "undefined" || !branding?.logo) return;
  const logo = branding.logo;
  setLinkHref('link[rel="icon"][sizes="32x32"]', logo.icon32Url);
  setLinkHref('link[rel="icon"][sizes="16x16"]', logo.icon16Url);
  setLinkHref('link[rel="apple-touch-icon"]', logo.appleIconUrl);
}

// Effective entry-page title: the owner's value or the ChatDesk wordmark.
export function brandingLoginTitle(branding) {
  const title = String(branding?.loginTitle || "").trim();
  return title || "ChatDesk";
}

export function brandingLoginTagline(branding) {
  return String(branding?.loginTagline || "").trim();
}

// URL for the entry-page logo — the uploaded PNG or the bundled SVG mark.
export function brandingLogoUrl(branding, fallback) {
  return branding?.logo?.logoUrl || fallback;
}
