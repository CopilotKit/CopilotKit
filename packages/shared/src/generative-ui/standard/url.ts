// Framework-free URL helpers of the standard components.

const SAFE_URL = /^(https?:|mailto:)/i;

/**
 * The trimmed URL when its scheme is http, https or mailto, else
 * `undefined`. Use it before a URL from agent data becomes an `href`.
 *
 * @example safeHref(" https://example.com ") // "https://example.com"
 */
export function safeHref(url: string) {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : undefined;
}

/**
 * The host name of a URL, with or without a scheme. `undefined` when the
 * text is not a URL.
 *
 * @example hostOf("example.com/page") // "example.com"
 */
export function hostOf(url: string) {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return undefined;
  }
}

/**
 * The URL of the favicon of a host, from Google's favicon service.
 *
 * @param host - A host name, for example the result of `hostOf`.
 */
export function faviconSrc(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

/**
 * Opens a URL in a new tab. An unsafe scheme (javascript:, data:) is
 * ignored. Does nothing where there is no `window.open`, for example on
 * the server or on React Native.
 *
 * @param href - The URL to open. `undefined` does nothing.
 */
export function openUrl(href: string | undefined) {
  if (!href || typeof window === "undefined") return;
  if (typeof window.open !== "function") return; // hermes-ok: feature check
  const safe = safeHref(href);
  if (safe) window.open(safe, "_blank", "noopener,noreferrer"); // hermes-ok: checked above
}
