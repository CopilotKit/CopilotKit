"use client";

// FrameworkSelector — persistent "agentic backend" dropdown that anchors
// the docs experience. Opens a panel listing every registry integration
// grouped by category. Selecting an entry navigates to
// `/<framework>/<current-feature>` when the page is framework-scopable,
// otherwise to `/<framework>` (the framework's landing page, which is
// itself a docs route under the catch-all).

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useFramework } from "./framework-provider";
import { FrameworkLogo } from "./icons/framework-icons";

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

/**
 * Strip a known framework prefix off the pathname. Returns the remainder
 * slug (no leading slash) or `null` when the path isn't framework-scoped.
 *
 * Only inspects the FIRST path segment — we deliberately do NOT recurse
 * into deeper segments so paths like `/<fw>/<fw>/x` preserve the inner
 * `<fw>/x` as the tail (the inner segment is part of the feature slug,
 * not a framework switch).
 */
function stripFrameworkPrefix(
  pathname: string,
  knownFrameworks: string[],
): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  // Guard: only the first segment is considered a framework prefix.
  if (!knownFrameworks.includes(parts[0])) return null;
  return parts.slice(1).join("/");
}

/** Strip the `/docs` prefix off the pathname to get the feature slug. */
function stripDocsPrefix(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "docs") return null;
  return parts.slice(1).join("/");
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
  const { effectiveFramework, knownFrameworks, setStoredFramework } =
    useFramework();
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

  // Compute the target href for a given framework option given the current
  // path. Preserves feature slug when possible.
  function hrefFor(slug: string): string {
    // Case 1: currently on /<existing-framework>/<rest>
    const frameworkTail = stripFrameworkPrefix(pathname, knownFrameworks);
    if (frameworkTail !== null) {
      return frameworkTail ? `/${slug}/${frameworkTail}` : `/${slug}`;
    }
    // Case 2: currently on /docs/<rest> — switch to framework-scoped (legacy)
    const docsTail = stripDocsPrefix(pathname);
    if (docsTail !== null && docsTail.length > 0) {
      return `/${slug}/${docsTail}`;
    }
    // Case 3: currently on /<unscoped-slug> (e.g. /quickstart) — preserve the
    // feature slug so switching frameworks keeps the user on the same topic.
    const unscopedTail = pathname.split("/").filter(Boolean).join("/");
    if (unscopedTail) {
      return `/${slug}/${unscopedTail}`;
    }
    // Fallback: framework landing page
    return `/${slug}`;
  }

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
    router.replace(hrefFor(slug));
    setOpen(false);
  }

  // Group options by category while preserving the category order declared
  // in the registry.
  const grouped = new Map<string, FrameworkOption[]>();
  for (const cat of categoryOrder) grouped.set(cat.id, []);
  grouped.set("other", []);
  for (const opt of options) {
    // Sidebar variant lifts BIA out of its category bucket and renders
    // it at the top of the dropdown — see render path below. Skip it
    // here so it doesn't also appear under Popular.
    if (isSidebar && opt.slug === "built-in-agent") continue;
    const bucket = grouped.has(opt.category) ? opt.category : "other";
    grouped.get(bucket)!.push(opt);
  }

  // BIA pinned at the top of the sidebar dropdown — only the sidebar
  // variant (the topbar selector keeps the standard category layout).
  const pinnedBIA = isSidebar
    ? (options.find((o) => o.slug === "built-in-agent") ?? null)
    : null;

  // Sidebar variant: full-width pill with integration logo on the left,
  // framework name centered, chevron right. Violet accent border when a
  // framework is active — matches the docs.copilotkit.ai reference.
  const sidebarBtnClasses = [
    "w-full flex items-center gap-2 px-3 py-2 rounded-lg border",
    "bg-[var(--bg-surface)] transition-colors cursor-pointer",
    "text-[13px] font-medium text-[var(--text)]",
    current
      ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent-light)] hover:bg-[var(--accent-light)]"
      : "border-dashed border-[var(--border)] hover:border-[var(--accent)]",
  ].join(" ");

  const topbarBtnClasses =
    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] text-[12px] font-medium text-[var(--text)] hover:border-[var(--accent)] transition-colors cursor-pointer max-w-[220px]";

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
            {current ? (
              <FrameworkLogo
                slug={current.slug}
                fallbackSrc={current.logo}
                size={20}
                className="shrink-0 text-[var(--text-secondary)]"
              />
            ) : (
              <span
                className="w-5 h-5 shrink-0 rounded-full bg-[var(--accent)] opacity-70"
                aria-hidden="true"
              />
            )}
            <span className="flex-1 min-w-0 text-left">
              {current ? (
                <span className="block truncate">{label}</span>
              ) : (
                <span className="block truncate text-[var(--text-muted)]">
                  Pick a backend
                </span>
              )}
              <span className="block text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)]">
                Agentic backend
              </span>
            </span>
            <svg
              className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]"
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
              ? "absolute top-full left-0 right-0 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg z-50 p-2"
              : "absolute top-full left-0 mt-1 w-[340px] max-h-[70vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg z-50 p-2"
          }
        >
          {pinnedBIA && (
            <div className="mb-2">
              <button
                key={pinnedBIA.slug}
                type="button"
                onClick={() => selectFramework(pinnedBIA.slug)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-colors cursor-pointer ${
                  pinnedBIA.slug === effectiveFramework
                    ? "bg-[var(--accent-light)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
                }`}
              >
                <FrameworkLogo
                  slug={pinnedBIA.slug}
                  fallbackSrc={pinnedBIA.logo}
                  size={16}
                  className="shrink-0"
                />
                <span className="flex-1 text-left truncate">
                  {displayNameFor(pinnedBIA)}
                </span>
              </button>
            </div>
          )}

          {[...grouped.entries()].map(([catId, opts]) => {
            if (opts.length === 0) return null;
            const catLabel =
              categoryOrder.find((c) => c.id === catId)?.name ??
              (catId === "other" ? "Other" : catId);
            return (
              <div key={catId} className="mb-2">
                <div className="px-2 pt-2 pb-1 text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)]">
                  {catLabel}
                </div>
                {opts.map((opt) => {
                  const isActive = opt.slug === effectiveFramework;
                  return (
                    <button
                      key={opt.slug}
                      type="button"
                      onClick={() => selectFramework(opt.slug)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-colors cursor-pointer ${
                        isActive
                          ? "bg-[var(--accent-light)] text-[var(--accent)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
                      }`}
                    >
                      <FrameworkLogo
                        slug={opt.slug}
                        fallbackSrc={opt.logo}
                        size={16}
                        className="shrink-0"
                      />
                      <span className="flex-1 text-left truncate">
                        {displayNameFor(opt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
