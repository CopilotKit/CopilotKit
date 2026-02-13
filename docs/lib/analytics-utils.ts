import { INTEGRATION_ORDER } from "./integrations";

/**
 * Normalizes URLs by converting integration routes from /integrations/{integration}/... to /{integration}/...
 * Also normalizes trailing slashes (removes them except for root).
 * Only normalizes known integration routes to ensure consistency.
 *
 * Examples:
 * - /integrations/langgraph → /langgraph
 * - /integrations/langgraph/shared-state → /langgraph/shared-state
 * - /langgraph/ → /langgraph
 * - /langgraph → /langgraph (already canonical)
 * - /reference → /reference (not an integration, unchanged)
 *
 * Use this for href attributes and canonical URLs.
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;

  // Split the URL into segments
  const segments = url.split("/").filter(Boolean);

  // Check if first segment is 'integrations'
  if (segments[0] === "integrations" && segments.length > 1) {
    const integrationId = segments[1];

    // Check if this is a known integration
    if (
      INTEGRATION_ORDER.includes(
        integrationId as (typeof INTEGRATION_ORDER)[number],
      )
    ) {
      // Reconstruct as canonical URL: /{integration}/{rest of path}
      const restOfPath = segments.slice(2).join("/");
      const normalized = `/${integrationId}${restOfPath ? "/" + restOfPath : ""}`;

      // Remove trailing slash (except for root)
      return normalized === "/" ? "/" : normalized.replace(/\/$/, "");
    }
  }

  // If not an integration route, normalize trailing slashes
  return url === "/" ? "/" : url.replace(/\/$/, "");
}

/**
 * Normalizes URLs for matching/comparison purposes.
 *
 * This function:
 * 1. First normalizes integration URLs (via normalizeUrl)
 * 2. Handles relative paths (../)
 * 3. Ensures consistent trailing slash handling
 *
 * Use this for comparing URLs (e.g., active state detection).
 *
 * Examples:
 * - ../langgraph → /langgraph
 * - /integrations/langgraph/ → /langgraph
 * - /langgraph/index → /langgraph/index (preserved for index matching logic)
 */
export function normalizeUrlForMatching(url: string): string {
  if (!url) return "";

  // Handle relative URLs (simplified - assumes they resolve to absolute)
  let normalized = url.startsWith("../") ? url.replace(/^\.\.\//, "/") : url;

  // First normalize integration URLs and trailing slashes
  normalized = normalizeUrl(normalized);

  // Remove trailing slashes (except for root) for consistent matching
  // Note: We preserve /index for index page matching logic
  return normalized === "/" ? "/" : normalized.replace(/\/$/, "");
}

/**
 * Normalizes pathnames for analytics tracking.
 * Alias for normalizeUrl for clarity in analytics context.
 */
export function normalizePathnameForAnalytics(pathname: string): string {
  return normalizeUrl(pathname);
}
