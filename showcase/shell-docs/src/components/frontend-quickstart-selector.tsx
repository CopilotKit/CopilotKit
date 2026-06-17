"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useFramework } from "./framework-provider";
import { FrontendLogo } from "./icons/frontend-icons";
import type { FrontendQuickstartSlug } from "@/lib/frontend-quickstarts";
import {
  FRONTEND_QUICKSTARTS,
  frontendQuickstartHref,
  selectedFrontendQuickstart,
} from "@/lib/frontend-quickstarts";
import {
  consumeSidebarFolderOpenOnce,
  FRONTEND_QUICKSTART_FOLDER_LABEL,
  requestSidebarFolderOpenOnce,
} from "@/lib/sidebar-folder-state";

function slugPathFromPathname(pathname: string, framework: string | null) {
  const segments = pathname.split("/").filter(Boolean);
  return (framework ? segments.slice(1) : segments).join("/");
}

export function FrontendQuickstartSelector() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { framework, effectiveFramework } = useFramework();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const slugPath = slugPathFromPathname(pathname, framework);
  const activeSlug = selectedFrontendQuickstart(slugPath) ?? "react";
  const active =
    FRONTEND_QUICKSTARTS.find((frontend) => frontend.slug === activeSlug) ??
    FRONTEND_QUICKSTARTS[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (!target) return;
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function selectFrontend(slug: FrontendQuickstartSlug) {
    const href = frontendQuickstartHref(effectiveFramework, slug);
    requestSidebarFolderOpenOnce(FRONTEND_QUICKSTART_FOLDER_LABEL);
    router.replace(href);
    if (href === pathname) {
      consumeSidebarFolderOpenOnce(FRONTEND_QUICKSTART_FOLDER_LABEL);
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="shell-docs-radius-control flex h-12 w-full cursor-pointer items-center gap-2 border border-[var(--nav-control-border)] bg-[var(--accent-dim)] p-1.5 text-[13px] font-medium text-[var(--text)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--nav-control-border-hover)] hover:bg-[var(--accent-light)]"
      >
        <span
          className="shell-docs-picker-icon-chip h-8 w-8 shrink-0"
          aria-hidden="true"
        >
          <FrontendLogo slug={active.iconKey} width={16} height={16} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate leading-tight">{active.label}</span>
          <span className="mt-0.5 block text-[9px] leading-tight text-[var(--text-faint)]">
            Frontend Quickstart
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="mr-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="listbox"
          className="shell-docs-radius-surface absolute left-0 right-0 top-full z-50 mt-1 border border-[var(--border)] bg-[var(--bg-surface)] p-2 shadow-[var(--shadow-panel)]"
        >
          {FRONTEND_QUICKSTARTS.map((frontend) => {
            const isActive = frontend.slug === active.slug;
            return (
              <button
                key={frontend.slug}
                type="button"
                onClick={() => selectFrontend(frontend.slug)}
                className={`shell-docs-radius-control flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px] transition-colors ${
                  isActive
                    ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
                }`}
              >
                <span className="shrink-0" aria-hidden="true">
                  <FrontendLogo
                    slug={frontend.iconKey}
                    width={16}
                    height={16}
                  />
                </span>
                <span className="flex-1 truncate text-left">
                  {frontend.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
