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
      setNotice({
        href: toRelativeHref(anchor.href),
        label: anchor.textContent?.trim() || "React docs",
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
        className="fixed inset-0 z-[70] cursor-default bg-black/15 backdrop-blur-[1px]"
        onClick={() => setNotice(null)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="react-docs-guidance-title"
        className="shell-docs-radius-surface fixed left-1/2 top-1/2 z-[80] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border border-[var(--border)] bg-[var(--bg-surface)] p-6 text-sm text-[var(--text)] shadow-[var(--shadow-modal)]"
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p
              id="react-docs-guidance-title"
              className="text-[18px] font-semibold leading-6 text-[var(--text)]"
            >
              These links open React SDK docs
            </p>
            <p className="mt-3 text-[14px] leading-6 text-[var(--text-muted)]">
              The {frontendName} SDK supports the same CopilotKit features as
              the React SDK. While we finish the dedicated {frontendName}{" "}
              guides, use these docs to see what CopilotKit can do and how the
              React version is structured. Your coding agent can translate the
              same feature into {frontendName}.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close"
            className="shell-docs-radius-control -mr-1 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
            onClick={() => setNotice(null)}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={notice.href}
            aria-label={`Open React docs: ${notice.label}`}
            className="shell-docs-radius-control inline-flex h-10 items-center gap-2 border border-[var(--border)] bg-[var(--accent)] px-4 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            onClick={() => setNotice(null)}
          >
            Open React docs
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <a
            href={guidanceHref(frontendId)}
            className="shell-docs-radius-control inline-flex h-10 items-center px-4 text-[13px] font-semibold text-[var(--accent)] underline decoration-[1px] underline-offset-[3px] hover:decoration-2"
            onClick={() => setNotice(null)}
          >
            How to use these docs
          </a>
        </div>
      </aside>
    </>
  );
}
