const SAFE_URL = /^(https?:|mailto:)/i;

/** The trimmed URL when it is http, https or mailto. Else `undefined`. */
export function safeHref(url: string) {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : undefined;
}

/** The host of a URL, with or without a scheme. */
export function hostOf(url: string) {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return undefined;
  }
}

/** The favicon of a host, from Google's favicon service. */
export function faviconSrc(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

/** Opens a URL in a new tab. An unsafe scheme (javascript:, data:) is ignored. */
export function openUrl(href: string | undefined) {
  if (!href || typeof window === "undefined") return;
  const safe = safeHref(href);
  if (safe) window.open(safe, "_blank", "noopener,noreferrer");
}
