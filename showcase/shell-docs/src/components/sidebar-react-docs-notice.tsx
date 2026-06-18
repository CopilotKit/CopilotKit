"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  frontendFromPathname,
  getFrontendOption,
} from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";

const REACT_DOCS_PROXY_SELECTOR = '[data-shell-docs-react-docs-proxy="true"]';

type ReactDocsNotice = {
  href: string;
  label: string;
  left: number;
  top: number;
};

function toRelativeHref(href: string): string {
  try {
    const url = new URL(href, window.location.origin);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

function guidanceHref(frontendId: FrontendId): string {
  return `/frontends/${frontendId}/using-these-docs`;
}

function getNoticePlacement(anchor: HTMLAnchorElement) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(390, window.innerWidth - 32);
  const maxLeft = Math.max(16, window.innerWidth - width - 16);
  const maxTop = Math.max(72, window.innerHeight - 220);
  const isDesktop = window.matchMedia("(min-width: 768px)").matches;
  const preferredLeft = isDesktop ? rect.right + 12 : rect.left;

  return {
    left: Math.min(Math.max(preferredLeft, 16), maxLeft),
    top: Math.min(Math.max(rect.top - 8, 72), maxTop),
  };
}

export function SidebarReactDocsNotice() {
  const pathname = usePathname() ?? "";
  const frontendId = frontendFromPathname(pathname);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState<ReactDocsNotice | null>(null);

  useEffect(() => {
    if (!frontendId) return;

    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      if (!anchor.closest("#nd-sidebar, #nd-sidebar-mobile")) return;
      if (!anchor.querySelector(REACT_DOCS_PROXY_SELECTOR)) return;

      event.preventDefault();
      const placement = getNoticePlacement(anchor);
      setNotice({
        href: toRelativeHref(anchor.href),
        label: anchor.textContent?.trim() || "React docs",
        ...placement,
      });
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [frontendId]);

  useEffect(() => {
    if (!notice) return;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotice(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [notice]);

  if (!frontendId || !notice) return null;

  const frontendName = getFrontendOption(frontendId).name;

  return (
    <>
      <button
        type="button"
        aria-label="Close React docs guidance"
        className="fixed inset-0 z-[70] cursor-default bg-transparent"
        onClick={() => setNotice(null)}
      />
      <aside
        role="dialog"
        aria-modal="false"
        aria-labelledby="react-docs-guidance-title"
        className="shell-docs-radius-surface fixed z-[80] w-[min(390px,calc(100vw-2rem))] border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text)] shadow-[var(--shadow-modal)]"
        style={{ left: notice.left, top: notice.top }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p
              id="react-docs-guidance-title"
              className="text-[13px] font-semibold text-[var(--text)]"
            >
              Use React docs as the feature map
            </p>
            <p className="mt-2 text-[12.5px] leading-5 text-[var(--text-muted)]">
              The {frontendName} SDK supports the same CopilotKit functionality
              as the React SDK. While dedicated guides fill in, use these React
              docs to pick features and have your coding agent build them here.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close"
            className="shell-docs-radius-control -mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
            onClick={() => setNotice(null)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a
            href={notice.href}
            aria-label={`Open React docs: ${notice.label}`}
            className="shell-docs-radius-control inline-flex h-8 items-center gap-1.5 border border-[var(--border)] bg-[var(--accent)] px-3 text-[12px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            onClick={() => setNotice(null)}
          >
            Open React docs
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <a
            href={guidanceHref(frontendId)}
            className="shell-docs-radius-control inline-flex h-8 items-center px-3 text-[12px] font-semibold text-[var(--accent)] underline decoration-[1px] underline-offset-[3px] hover:decoration-2"
            onClick={() => setNotice(null)}
          >
            Read more
          </a>
        </div>
      </aside>
    </>
  );
}
