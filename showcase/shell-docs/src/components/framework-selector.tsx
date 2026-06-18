"use client";

// FrameworkSelector — persistent "agentic backend" dropdown that anchors
// the docs experience. Opens a panel listing every registry integration
// grouped by category. Selecting an entry navigates to `/<framework>`:
// changing backends is a pivot into that framework's overview, not an
// attempt to preserve the current page's feature slug.

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { DEFAULT_FRAMEWORK, useFramework } from "./framework-provider";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";

export interface FrameworkOption {
  slug: string;
  name: string;
  category: string;
  logo?: string | null;
  deployed: boolean;
}

export interface FrameworkSelectorProps {
  options: FrameworkOption[];
  /**
   * Ordered category ids (from the registry) used to group entries in the
   * dropdown panel. Unknown categories fall through to "Other".
   */
  categoryOrder: { id: string; name: string }[];
  /** Extra wrapper class (positioning). */
  className?: string;
  /**
   * Presentation flavor.
   * - `topbar` (default, legacy): compact pill sized for a horizontal bar.
   * - `sidebar`: full-width pill with integration logo left, name center,
   *   chevron right — styled to match the docs.copilotkit.ai sidebar header.
   */
  variant?: "topbar" | "sidebar";
}

export function FrameworkSelector({
  options,
  categoryOrder,
  className,
  variant = "topbar",
}: FrameworkSelectorProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const posthog = usePostHog();
  const { effectiveFramework, setStoredFramework } = useFramework();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside-click / Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      // `e.target` is typed as `EventTarget | null`; `Node.contains`
      // requires an actual `Node`. Guard instead of casting so we don't
      // silently invoke `contains` with non-DOM targets (e.g. events
      // dispatched against `window`).
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

  // Display whatever the page is currently rendering as: URL framework
  // when present, then stored choice, then the soft-default
  // (Built-in Agent). The selector should never read "Pick a backend"
  // when the docs are actually rendering BIA code — that's misleading.
  const current = options.find((o) => o.slug === effectiveFramework);

  // BIA is the soft-default and the framing on the sidebar is "you're
  // reading CopilotKit's docs" rather than "you've picked the Built-in
  // Agent backend." Show "CopilotKit" in the sidebar selector chrome
  // (closed pill + dropdown row) but keep the registry name elsewhere
  // so DocsLandingNext, IntegrationGrid, etc. still call it Built-in
  // Agent where the framing is about choosing a backend.
  const isSidebar = variant === "sidebar";
  const displayNameFor = (opt: FrameworkOption) =>
    isSidebar && opt.slug === "built-in-agent" ? "CopilotKit" : opt.name;
  const label = current ? displayNameFor(current) : "Pick an agentic backend";

  function selectFramework(slug: string) {
    setStoredFramework(slug);
    // Fire a PostHog event so analytics dashboards can see which
    // backend readers pick. Wrapped in try/catch — PostHog can be
    // blocked by ad blockers or fail to initialize, and a broken
    // analytics call must never break navigation.
    try {
      const opt = options.find((o) => o.slug === slug);
      posthog?.capture("docs.framework_selected", {
        framework: slug,
        framework_name: opt?.name ?? slug,
        category: opt?.category,
        from_path: pathname,
      });
    } catch {
      // Swallow — analytics is fire-and-forget.
    }
    // replace vs push: picking a backend is a pivot on the same logical
    // page, not a forward navigation. Using `push` clutters the back
    // stack with every framework the user clicked through, which makes
    // the browser Back button useless. `replace` keeps history sane.
    // Framework changes intentionally drop the current feature slug. The
    // selector is a backend pivot, so landing on the framework root gives
    // readers the right overview before they drill into framework-specific
    // docs. The default framework's docs are served at the root, so its
    // pivot target is `/`.
    router.replace(slug === DEFAULT_FRAMEWORK ? "/" : `/${slug}`);
    setOpen(false);
  }

  // Single flat list, ordered by the canonical display order. The
  // category buckets ("Most Popular / Agent Frameworks / Intelligence Platform /
  // Emerging") used to live here but partners read them as a tier
  // list — we now show every backend in one neutral list.
  const flatOptions = options
    .filter((opt) => !(isSidebar && opt.slug === "built-in-agent"))
    .slice()
    .sort((a, b) => compareByDisplayOrder(a.slug, b.slug));

  // BIA pinned at the top of the sidebar dropdown — only the sidebar
  // variant (the topbar selector renders the flat list inline).
  const pinnedBIA = isSidebar
    ? (options.find((o) => o.slug === "built-in-agent") ?? null)
    : null;

  // Sidebar variant: full-width select with integration logo box on the
  // left, framework name center, chevron right. It uses the global
  // shadcn radius and a subtle accent wash so it reads as a selected
  // docs context control without hardcoding a lavender value.
  const sidebarBtnClasses = [
    "shell-docs-radius-control w-full flex items-center gap-2 p-1.5 border h-12",
    "shadow-[var(--shadow-control)] transition-colors cursor-pointer",
    "text-[13px] font-medium text-[var(--text)]",
    current
      ? "bg-[var(--accent-dim)] border-[var(--nav-control-border)] hover:bg-[var(--accent-light)] hover:border-[var(--nav-control-border-hover)]"
      : "bg-[var(--bg-surface)]/60 border-[var(--border)] hover:border-[var(--accent)]",
  ].join(" ");

  const topbarBtnClasses =
    "shell-docs-radius-control flex items-center gap-1.5 px-2.5 py-1.5 border border-[var(--border)] bg-[var(--bg-surface)] text-[12px] font-medium text-[var(--text)] hover:border-[var(--accent)] transition-colors cursor-pointer max-w-[220px]";

  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={isSidebar ? sidebarBtnClasses : topbarBtnClasses}
      >
        {isSidebar ? (
          <>
            <span
              className={`shell-docs-picker-icon-chip h-8 w-8 shrink-0 ${
                current ? "" : "border-[var(--border)] text-[var(--text-faint)]"
              }`}
              aria-hidden="true"
            >
              {current ? (
                <FrameworkLogo
                  slug={current.slug}
                  fallbackSrc={current.logo}
                  size={16}
                  className="text-[var(--accent)]"
                />
              ) : (
                <span className="h-2.5 w-2.5 bg-current" />
              )}
            </span>
            <span className="flex-1 min-w-0 text-left">
              {current ? (
                <span className="block truncate leading-tight">{label}</span>
              ) : (
                <span className="block truncate leading-tight text-[var(--text-muted)]">
                  Pick a backend
                </span>
              )}
              <span className="block text-[9px] uppercase tracking-wider text-[var(--text-faint)] leading-tight mt-0.5">
                Agentic backend
              </span>
            </span>
            <svg
              className="w-3.5 h-3.5 mr-0.5 shrink-0 text-[var(--text-muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
            <span className="truncate">
              {current ? (
                <>
                  <span className="text-[var(--text-faint)] font-mono text-[10px] uppercase tracking-wider mr-1">
                    Backend
                  </span>
                  {label}
                </>
              ) : (
                <span className="text-[var(--text-muted)]">{label}</span>
              )}
            </span>
            <svg
              className="w-3 h-3 shrink-0 text-[var(--text-muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="listbox"
          className={
            isSidebar
              ? "shell-docs-radius-surface absolute top-full left-0 right-0 mt-1 max-h-[60vh] overflow-y-auto border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)] z-50 p-2"
              : "shell-docs-radius-surface absolute top-full left-0 mt-1 w-[340px] max-h-[70vh] overflow-y-auto border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)] z-50 p-2"
          }
        >
          {pinnedBIA && (
            <button
              key={pinnedBIA.slug}
              type="button"
              onClick={() => selectFramework(pinnedBIA.slug)}
              className={`shell-docs-radius-control w-full flex items-center gap-2 px-2 py-1.5 text-[13px] transition-colors cursor-pointer ${
                pinnedBIA.slug === effectiveFramework
                  ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
              }`}
            >
              <FrameworkLogo
                slug={pinnedBIA.slug}
                fallbackSrc={pinnedBIA.logo}
                size={16}
                className="shrink-0 text-[var(--accent)]"
              />
              <span className="flex-1 text-left truncate">
                {displayNameFor(pinnedBIA)}
              </span>
            </button>
          )}

          <div>
            {flatOptions.map((opt) => {
              const isActive = opt.slug === effectiveFramework;
              return (
                <button
                  key={opt.slug}
                  type="button"
                  onClick={() => selectFramework(opt.slug)}
                  className={`shell-docs-radius-control w-full flex items-center gap-2 px-2 py-1.5 text-[13px] transition-colors cursor-pointer ${
                    isActive
                      ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
                  }`}
                >
                  <FrameworkLogo
                    slug={opt.slug}
                    fallbackSrc={opt.logo}
                    size={16}
                    className="shrink-0 text-[var(--accent)]"
                  />
                  <span className="flex-1 text-left truncate">
                    {displayNameFor(opt)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
