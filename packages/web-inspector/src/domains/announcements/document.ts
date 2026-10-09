import { marked } from "marked";

const FALLBACK_BASE_URL = "https://copilotkit.ai";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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

export function renderAnnouncementDocument(
  markdown: string,
  baseUrl = typeof window === "undefined"
    ? FALLBACK_BASE_URL
    : window.location.href,
): string {
  const renderer = new marked.Renderer();
  renderer.link = (href, title, text) => {
    const safeHref = escapeHtmlAttribute(announcementHref(href ?? "", baseUrl));
    const titleAttribute = title
      ? ` title="${escapeHtmlAttribute(title)}"`
      : "";
    return `<a href="${safeHref}" target="_blank" rel="noopener"${titleAttribute}>${text}</a>`;
  };
  renderer.html = (markup) => escapeHtml(markup);
  renderer.code = (code, language) => {
    const safeLanguage = (language ?? "").replace(/[^a-z0-9-]/gi, "");
    const languageClass = safeLanguage
      ? ` class="language-${safeLanguage}"`
      : "";
    return `<div class="announcement-code"><pre><code${languageClass}>${escapeHtml(code)}</code></pre><div class="announcement-code__copy-shield"><cpk-inspector-copy-button class="announcement-code__copy" value="${escapeHtmlAttribute(code)}" accessible-label="Copy code" copied-label="Copied" reset-delay-ms="1500"></cpk-inspector-copy-button></div></div>`;
  };

  const rendered = marked.parse(markdown, { renderer, async: false });
  if (typeof rendered !== "string") {
    throw new TypeError("Announcement Markdown rendering must be synchronous");
  }
  return rendered;
}
