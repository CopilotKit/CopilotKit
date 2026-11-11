/**
 * URL checks shared by the text and card renderers, so the allowed link
 * schemes cannot drift between them.
 */

/**
 * Allow only safe link schemes. Permits http:, https:, and mailto:
 * (case-insensitive), scheme-relative `//host` URLs, and relative URLs that
 * carry no scheme at all (no `:` before the first `/`, `?`, or `#`). Any
 * other scheme (javascript:, data:, vbscript:, file:, …) is rejected so it
 * can't be emitted as a link target.
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) return true; // scheme-relative
  const colon = trimmed.indexOf(":");
  if (colon === -1) return true; // no scheme → relative
  const slash = trimmed.indexOf("/");
  const question = trimmed.indexOf("?");
  const hash = trimmed.indexOf("#");
  // A ':' that appears only after a path/query/fragment separator is not a
  // scheme delimiter (e.g. "/a:b", "?x:y") — treat those as relative.
  const beforeDelimiter = (d: number) => d === -1 || colon < d;
  if (
    beforeDelimiter(slash) &&
    beforeDelimiter(question) &&
    beforeDelimiter(hash)
  ) {
    const scheme = trimmed.slice(0, colon).toLowerCase();
    return scheme === "http" || scheme === "https" || scheme === "mailto";
  }
  return true;
}

/** Cards v2 loads images only from absolute HTTPS URLs. */
export function isAbsoluteHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
