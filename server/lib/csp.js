// ─── Content-Security-Policy header (Stage 4, LOW review item) ────────────────
//
// Defense-in-depth complement to the Stage 2 markdown/XSS sanitisation fixes:
// until now the server sent no CSP header at all. The policy is deliberately
// moderate so it cannot break the Vite-built SPA:
//   • client/dist/index.html ships an INLINE theme-preload <script> and an
//     inline <style>, so script-src/style-src need 'unsafe-inline'.
//   • hashed asset files are same-origin ('self'); modulepreload links are
//     plain same-origin requests, not scripts.
//   • markdown rendering can embed remote https: images; avatars may be
//     remote; media previews use blob:; emoji/paste previews use data:.
//   • realtime uses WebSocket (ws:/wss:), SSE and web-push fetches go to
//     same-origin or configured https: endpoints.
//
// Env overrides (checked per request so toggling needs no restart):
//   CSP_HEADER        → used verbatim instead of the default policy
//   CSP_REPORT_ONLY=1 → delivered as Content-Security-Policy-Report-Only
//
// Exported as a tiny helper (rather than being inlined in server/index.js)
// so the policy itself is unit-testable without booting the server.

const DEFAULT_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; " +
  "media-src 'self' blob: https:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' https: wss:; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'none'";

const CSP_HEADER_NAME = "Content-Security-Policy";
const CSP_REPORT_ONLY_HEADER_NAME = "Content-Security-Policy-Report-Only";

function isTruthyEnv(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

/**
 * Resolve the CSP header to set for the current environment.
 *
 * @param {Object} env – process.env-like object (defaults to process.env)
 * @returns {{ name: string, value: string, headerName: string, header: string }}
 *          `name`/`value` for readability; `headerName`/`header` are the
 *          arguments for res.setHeader(). `header` is "" when the policy is
 *          disabled entirely (CSP_HEADER set to "off"/"none"/"disabled").
 */
export function buildCspHeader(env = process.env) {
  const override = String(env?.CSP_HEADER || "").trim();
  const reportOnly = isTruthyEnv(env?.CSP_REPORT_ONLY);

  // Explicit opt-out: CSP_HEADER="off" (or "none"/"disabled") disables the
  // header entirely — useful for exotic reverse-proxy-managed deployments.
  if (/^(off|none|disabled)$/i.test(override)) {
    return { name: null, value: "", headerName: null, header: "" };
  }

  if (override) {
    return {
      name: reportOnly ? CSP_REPORT_ONLY_HEADER_NAME : CSP_HEADER_NAME,
      value: override,
      headerName: reportOnly ? CSP_REPORT_ONLY_HEADER_NAME : CSP_HEADER_NAME,
      header: override,
    };
  }

  return {
    name: reportOnly ? CSP_REPORT_ONLY_HEADER_NAME : CSP_HEADER_NAME,
    value: DEFAULT_CSP,
    headerName: reportOnly ? CSP_REPORT_ONLY_HEADER_NAME : CSP_HEADER_NAME,
    header: DEFAULT_CSP,
  };
}

export { DEFAULT_CSP };
