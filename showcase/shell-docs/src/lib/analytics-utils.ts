import { getIntegrations } from "@/lib/registry";

/**
 * Normalizes URLs by converting integration routes from /integrations/{integration}/... to /{integration}/...
 * Also normalizes trailing slashes (removes them except for root).
 * Only normalizes known integration routes to ensure consistency.
 *
 * Examples:
 * - /integrations/langgraph -> /langgraph
 * - /integrations/langgraph/shared-state -> /langgraph/shared-state
 * - /langgraph/ -> /langgraph
 * - /langgraph -> /langgraph (already canonical)
 * - /reference -> /reference (not an integration, unchanged)
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;

  const segments = url.split("/").filter(Boolean);

  if (segments[0] === "integrations" && segments.length > 1) {
    const integrationId = segments[1];
    const knownSlugs = new Set(getIntegrations().map((i) => i.slug));

    if (knownSlugs.has(integrationId)) {
      const restOfPath = segments.slice(2).join("/");
      const normalized = `/${integrationId}${
        restOfPath ? "/" + restOfPath : ""
      }`;
      return normalized === "/" ? "/" : normalized.replace(/\/$/, "");
    }
  }

  return url === "/" ? "/" : url.replace(/\/$/, "");
}

/**
 * Normalizes pathnames for analytics tracking.
 * Alias for normalizeUrl for clarity in analytics context.
 */
export function normalizePathnameForAnalytics(pathname: string): string {
  return normalizeUrl(pathname);
}
