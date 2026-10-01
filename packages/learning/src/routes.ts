const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d+$/;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,}$/;
const HAS_DIGIT = /\d/;
const SENSITIVE_PUNCTUATION = /[.@%=]/;

// ponytail: shape heuristic, not a dictionary. Slugs like "alice" stay; add a route template for exact names.
function isIdLike(segment: string) {
  const isToken = TOKEN.test(segment) && HAS_DIGIT.test(segment);
  return (
    DIGITS.test(segment) ||
    UUID.test(segment) ||
    LONG_HEX.test(segment) ||
    SENSITIVE_PUNCTUATION.test(segment) ||
    isToken
  );
}

function splitPath(pathname: string) {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function matchesTemplate(segments: string[], template: string) {
  const parts = splitPath(template);
  if (parts.length !== segments.length) return false;
  return parts.every(
    (part, index) => part.startsWith(":") || part === segments[index],
  );
}

/**
 * Turns a pathname into a route without IDs.
 *
 * A matching template wins (`/deals/:id`). Otherwise ID-like segments and
 * segments containing `.`, `@`, `%`, or `=` become `:id`.
 * Pass a pathname only: the query string and hash are never part of a route.
 *
 * @example toRoute("/deals/42/notes", ["/deals/:dealId/notes"]) // "/deals/:dealId/notes"
 */
export function toRoute(pathname: string, templates: string[] = []) {
  const segments = splitPath(pathname);
  const template = templates.find((candidate) =>
    matchesTemplate(segments, candidate),
  );
  if (template !== undefined) return template;
  const masked = segments.map((segment) =>
    isIdLike(segment) ? ":id" : segment,
  );
  return `/${masked.join("/")}`;
}

/**
 * Splits a URL into its origin and a masked route. The query string and hash are dropped.
 *
 * @param url Absolute or relative URL.
 * @param base Base for relative URLs. Defaults to the current page.
 */
export function toOriginAndRoute(
  url: string,
  templates: string[] = [],
  base: string = globalThis.location?.href ?? "http://localhost/",
) {
  const parsed = new URL(url, base);
  return { origin: parsed.origin, route: toRoute(parsed.pathname, templates) };
}
