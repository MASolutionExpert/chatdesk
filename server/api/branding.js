// ─── Public branding routes (1.7.0-dev.2) ────────────────────────────────────
//
// Unauthenticated endpoints the client needs BEFORE login:
//   • GET /api/branding                — effective branding config + URLs
//   • GET /api/branding/logo.png       — the uploaded logo (512×512 PNG)
//   • GET /api/branding/icon-<n>.png   — pre-sized favicon/app icons
//
// All of them 404/serve-defaults gracefully when the instance has no custom
// logo, so unpersonalized installs behave exactly like before.

import { BRANDING_ICON_SIZES } from "../lib/branding.js";

function registerBrandingRoutes(app, deps) {
  const service = deps.brandingService;

  app.get("/api/branding", async (req, res) => {
    if (!service) {
      return res.status(503).json({ error: "Branding service unavailable." });
    }
    try {
      res.setHeader("Cache-Control", "no-cache");
      res.json(await service.getConfig());
    } catch (err) {
      res.status(500).json({ error: String(err?.message || "Branding lookup failed.") });
    }
  });

  const sendIcon = (req, res, size) => {
    if (!service) {
      return res.status(503).json({ error: "Branding service unavailable." });
    }
    if (!BRANDING_ICON_SIZES.includes(Number(size))) {
      return res.status(404).json({ error: "Unknown icon size." });
    }
    const buffer = service.readIcon(size);
    if (!buffer) {
      // No custom logo — the client keeps the bundled icons.
      return res.status(404).json({ error: "No custom logo configured." });
    }
    res.setHeader("Content-Type", "image/png");
    // Versioned URLs (?v=<upload timestamp>) are immutable: a new upload
    // produces brand-new URLs, so the old bytes can be cached forever without
    // ever shadowing the new logo. Unversioned requests revalidate instead of
    // trusting a stale cached copy — this is what fixes the "uploaded a new
    // logo but the old one keeps showing" bug.
    const versioned = Boolean(req?.query?.v);
    res.setHeader(
      "Cache-Control",
      versioned ? "public, max-age=31536000, immutable" : "no-cache, must-revalidate",
    );
    res.send(buffer);
  };

  app.get("/api/branding/logo.png", (req, res) => sendIcon(req, res, 512));
  app.get("/api/branding/icon-:size.png", (req, res) => sendIcon(req, res, req.params.size));
}

export { registerBrandingRoutes };
