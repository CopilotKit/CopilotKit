"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/telemetry/analytics";

/**
 * shell-docs' `target` names for the Open menu's links (GitHub, View as
 * Markdown, and the AI apps), so `open_in_llm_clicked` breaks down as before.
 */
function openTarget(link: HTMLAnchorElement): string {
  const url = new URL(link.href, window.location.href);
  if (url.origin === window.location.origin) {
    return url.pathname.endsWith(".md") ? "view-as-markdown" : url.pathname;
  }
  const host = url.hostname.replace(/^www\./, "");
  const known: Record<string, string> = {
    "github.com": "github",
    "chatgpt.com": "chatgpt",
    "claude.ai": "claude",
    "cursor.com": "cursor",
    "scira.ai": "scira",
  };
  return known[host] ?? host;
}

/**
 * Wraps a page's actions (Fumadocs' stock `MarkdownCopyButton` and
 * `ViewOptionsPopover`, which send no events) and reports their clicks with
 * shell-docs' events: `markdown_copied` and `open_in_llm_clicked`. The Open
 * menu renders in a portal, but React delivers its clicks here through the
 * component tree. `markdown_copied` fires on the click; Fumadocs' button
 * doesn't expose when the copy finishes.
 */
export function TrackedPageActions({
  markdownUrl,
  className,
  children,
}: {
  markdownUrl: string;
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div
      className={className}
      onClickCapture={(event) => {
        const control = (event.target as Element).closest("a, button");
        if (!control) return;
        // The page marks its Copy Markdown button `data-page-action="copy-markdown"`.
        if (control.getAttribute("data-page-action") === "copy-markdown") {
          trackEvent("markdown_copied", {
            path: pathname,
            markdown_url: markdownUrl,
          });
        } else if (control instanceof HTMLAnchorElement) {
          trackEvent("open_in_llm_clicked", {
            target: openTarget(control),
            path: pathname,
          });
        }
      }}
    >
      {children}
    </div>
  );
}
