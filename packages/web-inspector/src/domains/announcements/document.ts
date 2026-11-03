import { renderMarkdownToHtml } from "./markdown.js";

const FALLBACK_BASE_URL = "https://copilotkit.ai";

function announcementHref(href: string, baseUrl: string): string {
  try {
    const isRootRelative = href.startsWith("/") && !href.startsWith("//");
    const url = new URL(href, baseUrl);
    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:" &&
      url.protocol !== "mailto:"
    ) {
      return "#";
    }
    if (!url.searchParams.has("ref")) {
      url.searchParams.append("ref", "cpk-inspector");
    }
    return isRootRelative
      ? `${url.pathname}${url.search}${url.hash}`
      : url.toString();
  } catch {
    return "#";
  }
}

/** An image source the article may load: http(s) only, resolved to absolute. */
function announcementImageSrc(src: string, baseUrl: string): string | null {
  try {
    const url = new URL(src, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function renderAnnouncementDocument(
  markdown: string,
  baseUrl = typeof window === "undefined"
    ? FALLBACK_BASE_URL
    : window.location.href,
): string {
  return renderMarkdownToHtml(markdown, {
    linkHref: (href) => announcementHref(href, baseUrl),
    imageSrc: (src) => announcementImageSrc(src, baseUrl),
  });
}
