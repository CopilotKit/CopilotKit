/**
 * Activity type for MCP Apps events - must match the middleware's MCPAppsActivityType.
 */
export const MCPAppsActivityType = "mcp-apps";

/**
 * URL schemes a widget may NOT open via ui/open-link. The ext-apps schema
 * validates `url` as a plain string only (noopener/noreferrer does not restrict
 * the scheme), so ui/open-link could otherwise become an XSS vector.
 *
 * We use a denylist rather than an allowlist on purpose: deep links use
 * arbitrary, app-defined schemes (`myapp:`, `whatsapp:`, `slack:`, `spotify:`,
 * `sms:`, ...) that an allowlist could never enumerate, and `window.open`ing them
 * just hands off to an OS handler - it does not execute script in the page, so
 * it is not an XSS risk. Universal links / App Links are plain `https:` URLs and
 * pass regardless. What IS dangerous is the small, well-known set of schemes
 * that execute script or render attacker HTML in the page context; block those
 * and allow everything else (including deep links).
 */
export const MCP_OPEN_LINK_BLOCKED_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "blob:",
  "file:",
]);
