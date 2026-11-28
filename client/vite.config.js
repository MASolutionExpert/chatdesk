import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

/**
 * Rewrite the literal `const CACHE_VERSION = "...";` in the built service
 * worker with a per-build value. Pure so it can be unit-tested without the
 * filesystem. Returns null when the placeholder is missing (no change).
 */
export const rewriteSwCacheVersion = (source, buildVersion) => {
  if (!buildVersion) return null;
  const replaced = source.replace(
    /const CACHE_VERSION = "[^"]*";/,
    `const CACHE_VERSION = "${String(buildVersion).replace(/["\\]/g, "")}";`,
  );
  return replaced === source ? null : replaced;
};

/**
 * Per-build service worker cache version. A unique CACHE_VERSION per deploy
 * makes CACHE_NAME unique, so the SW activate handler prunes the hashed
 * /assets/* bundles of previous deploys instead of accumulating them forever.
 */
const swCacheVersionPlugin = () => ({
  name: "chatdesk-sw-cache-version",
  apply: "build",
  closeBundle() {
    const swPath = path.resolve(import.meta.dirname, "dist/sw.js");
    try {
      if (!fs.existsSync(swPath)) return;
      const source = fs.readFileSync(swPath, "utf8");
      const buildVersion = `${new Date()
        .toISOString()
        .replace(/[^0-9]/g, "")
        .slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
      const next = rewriteSwCacheVersion(source, buildVersion);
      if (!next) {
        console.warn("sw.js cache-version rewrite: placeholder not found");
        return;
      }
      fs.writeFileSync(swPath, next);
    } catch (err) {
      // A failed rewrite must never break the build; the SW just keeps the
      // static fallback CACHE_VERSION.
      console.warn("sw.js cache-version rewrite failed:", err?.message || err);
    }
  },
});

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(import.meta.dirname, ".."), "");
  const apiPort = Number(
    rootEnv.SERVER_PORT ||
      rootEnv.PORT ||
      process.env.SERVER_PORT ||
      process.env.PORT ||
      5174,
  );
  const analyze =
    String(rootEnv.ANALYZE || process.env.ANALYZE || "").toLowerCase() ===
    "true";

  return {
    plugins: [
      react(),
      swCacheVersionPlugin(),
      ...(analyze
        ? [
            visualizer({
              filename: "dist/stats.html",
              gzipSize: true,
              brotliSize: true,
              open: false,
            }),
          ]
        : []),
    ],
    envDir: "..",
    envPrefix: ["APP_", "CHAT_", "FILE_", "MESSAGE_", "ACCOUNT_", "SIGN_"],
    build: {
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "react-core";
            }
            if (id.includes("/lucide-react/")) {
              return "icons";
            }
            if (
              id.includes("/marked/") ||
              id.includes("/dompurify/") ||
              id.includes("/highlight.js/")
            ) {
              return "markdown";
            }
            return "vendor";
          },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
        "/ws": {
          target: `http://localhost:${apiPort}`,
          ws: true,
        },
      },
    },
  };
});
