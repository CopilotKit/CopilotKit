"use client";

// FrameworkSelector - persistent docs selector. The sidebar variant
// exposes frontend and agent backend as separate, simple dropdowns.

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { DEFAULT_FRAMEWORK, useFramework } from "./framework-provider";
import { FrontendLogo } from "./frontend-logo";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";
import {
  FRONTEND_OPTIONS,
  backendPathForCurrentPath,
  frontendFromPathname,
  frontendPathForCurrentPath,
  isFrontendEarlyAccess,
} from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";

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
   * - `sidebar`: two full-width selector rows for frontend and backend.
   */
  variant?: "topbar" | "sidebar";
}

function SelectorAffordance({ active }: { active: boolean }) {
  return (
    <span className="ml-1 flex shrink-0 items-center" aria-hidden="true">
      <ChevronDown
        className={`h-3.5 w-3.5 transition-colors ${
          active
            ? "text-[var(--accent)]"
            : "text-[var(--text-muted)] group-hover:text-[var(--accent)]"
        }`}
        strokeWidth={2}
      />
    </span>
  );
}

function FrontendEarlyAccessBadge() {
  return (
    <span className="shell-docs-radius-control inline-flex shrink-0 self-center border border-[var(--border)] bg-[var(--bg-elevated)] px-1 py-0 text-[8px] font-semibold leading-[10px] text-[var(--text-muted)]">
      Early access
    </span>
  );
}

export function FrameworkSelector({
  options,
  categoryOrder: _categoryOrder,
  className,
  variant = "topbar",
}: FrameworkSelectorProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const posthog = usePostHog();
  const { effectiveFramework, setStoredFramework } = useFramework();
  const urlFrontend = frontendFromPathname(pathname);
  const [openMenu, setOpenMenu] = useState<"frontend" | "backend" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!openMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpenMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openMenu]);

  // Display whatever the page is currently rendering as: URL framework
  // when present, then stored choice, then the soft-default.
  const current = options.find((o) => o.slug === effectiveFramework);

  const isSidebar = variant === "sidebar";
  const displayNameFor = (opt: FrameworkOption) =>
    isSidebar && opt.slug === "built-in-agent" ? "CopilotKit" : opt.name;
  const label = current ? displayNameFor(current) : "Pick an agentic backend";
  const effectiveFrontendId = urlFrontend ?? "react";
  const selectedFrontend =
    FRONTEND_OPTIONS.find((option) => option.id === effectiveFrontendId) ??
    FRONTEND_OPTIONS[0];

  function selectFrontend(id: FrontendId) {
    if (id !== effectiveFrontendId) {
      router.replace(
        frontendPathForCurrentPath(
          id,
          pathname,
          options.map((option) => option.slug),
        ),
      );
    }
    setOpenMenu(null);
  }

  function selectFramework(slug: string) {
    setStoredFramework(slug);
    try {
      const opt = options.find((o) => o.slug === slug);
      posthog?.capture("docs.framework_selected", {
        framework: slug,
        framework_name: opt?.name ?? slug,
        category: opt?.category,
        from_path: pathname,
      });
    } catch {
      // Swallow - analytics is fire-and-forget.
    }
    router.replace(
      backendPathForCurrentPath(
        slug,
        pathname,
        options.map((option) => option.slug),
        DEFAULT_FRAMEWORK,
      ),
    );
    setOpenMenu(null);
  }

  // Single flat list, ordered by the canonical display order. The
  // category buckets ("Most Popular / Agent Frameworks / Intelligence Platform /
  // Emerging") used to live here but partners read them as a tier
  // list — we now show every backend in one neutral list.
  const flatOptions = options
    .filter((opt) => !(isSidebar && opt.slug === "built-in-agent"))
    .slice()
    .sort((a, b) => compareByDisplayOrder(a.slug, b.slug));

  const pinnedBIA = isSidebar
    ? (options.find((o) => o.slug === "built-in-agent") ?? null)
    : null;

  const topbarBtnClasses =
    "shell-docs-framework-picker shell-docs-radius-control flex items-center gap-1.5 px-2.5 py-1.5 border border-[var(--border)] bg-[var(--card)] text-[12px] font-medium text-[var(--foreground)] hover:border-[var(--brand-accent)] transition-colors cursor-pointer max-w-[220px]";

  const backendOptions = (
    includePinnedBIA: boolean,
    optionHoverClass: string,
  ) => (
    <>
      {includePinnedBIA && pinnedBIA && (
        <button
          key={pinnedBIA.slug}
          type="button"
          role="option"
          aria-selected={pinnedBIA.slug === effectiveFramework}
          onClick={() => selectFramework(pinnedBIA.slug)}
          className={`shell-docs-radius-control flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            pinnedBIA.slug === effectiveFramework
              ? "bg-[var(--accent-dim)] text-[var(--accent)]"
              : `text-[var(--text-secondary)] ${optionHoverClass}`
          }`}
        >
          <FrameworkLogo
            slug={pinnedBIA.slug}
            fallbackSrc={pinnedBIA.logo}
            size={16}
            className="shrink-0 text-[var(--accent)]"
          />
          <span className="flex-1 truncate text-left">
            {displayNameFor(pinnedBIA)}
          </span>
        </button>
      )}

      {flatOptions.map((opt) => {
        const isActive = opt.slug === effectiveFramework;
        return (
          <button
            key={opt.slug}
            type="button"
            role="option"
            aria-selected={isActive}
            onClick={() => selectFramework(opt.slug)}
            className={`shell-docs-radius-control flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              isActive
                ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                : `text-[var(--text-secondary)] ${optionHoverClass}`
            }`}
          >
            <FrameworkLogo
              slug={opt.slug}
              fallbackSrc={opt.logo}
              size={16}
              className="shrink-0 text-[var(--accent)]"
            />
            <span className="flex-1 truncate text-left">
              {displayNameFor(opt)}
            </span>
          </button>
        );
      })}
    </>
  );

  return (
    <div
      ref={rootRef}
      className={`relative ${openMenu ? "z-50" : ""} ${className ?? ""}`}
    >
      {isSidebar ? (
        <>
          <div className="shell-docs-picker-group shell-docs-picker-group-bordered shell-docs-sidebar-context-picker space-y-0.5">
            <button
              type="button"
              onClick={() =>
                setOpenMenu((menu) => (menu === "frontend" ? null : "frontend"))
              }
              aria-haspopup="listbox"
              aria-expanded={openMenu === "frontend"}
              aria-label="Choose frontend"
              className="shell-docs-picker-row group flex min-h-[52px] w-full cursor-pointer items-center gap-2.5 px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span
                className="shell-docs-picker-icon-chip flex h-8 w-8 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                <FrontendLogo icon={selectedFrontend.icon} size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium leading-tight text-[var(--text-muted)]">
                  Frontend
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-tight text-[var(--text)]">
                  <span className="truncate">{selectedFrontend.name}</span>
                  {isFrontendEarlyAccess(selectedFrontend.id) && (
                    <FrontendEarlyAccessBadge />
                  )}
                </span>
              </span>
              <SelectorAffordance active={openMenu === "frontend"} />
            </button>

            <button
              type="button"
              onClick={() =>
                setOpenMenu((menu) => (menu === "backend" ? null : "backend"))
              }
              aria-haspopup="listbox"
              aria-expanded={openMenu === "backend"}
              aria-label="Choose agent backend"
              className="shell-docs-picker-row shell-docs-picker-row-divided group flex min-h-[52px] w-full cursor-pointer items-center gap-2.5 px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span
                className="shell-docs-picker-icon-chip flex h-8 w-8 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                {current ? (
                  <FrameworkLogo
                    slug={current.slug}
                    fallbackSrc={current.logo}
                    size={17}
                    className="text-[var(--accent)]"
                  />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] opacity-70" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium leading-tight text-[var(--text-muted)]">
                  Agent backend
                </span>
                {current ? (
                  <span className="mt-0.5 block truncate text-[13px] font-semibold leading-tight text-[var(--text)]">
                    {label}
                  </span>
                ) : (
                  <span className="mt-0.5 block truncate text-[13px] font-medium leading-tight text-[var(--text-muted)]">
                    No backend selected
                  </span>
                )}
              </span>
              <SelectorAffordance active={openMenu === "backend"} />
            </button>
          </div>

          {openMenu === "frontend" && (
            <div
              role="listbox"
              aria-label="Choose frontend"
              className="shell-docs-radius-surface shell-docs-picker-menu absolute left-0 right-0 top-full z-50 mt-1 border border-[var(--border)] bg-[var(--bg-surface)] p-2"
            >
              {FRONTEND_OPTIONS.map((option) => {
                const isActive = option.id === selectedFrontend.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => selectFrontend(option.id)}
                    className={`shell-docs-radius-control flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      isActive
                        ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
                    }`}
                  >
                    <span
                      className="shell-docs-picker-icon-chip flex h-7 w-7 shrink-0 items-center justify-center"
                      aria-hidden="true"
                    >
                      <FrontendLogo icon={option.icon} size={17} />
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-left font-medium">
                      <span className="truncate">{option.name}</span>
                      {isFrontendEarlyAccess(option.id) && (
                        <FrontendEarlyAccessBadge />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {openMenu === "backend" && (
            <div
              role="listbox"
              aria-label="Choose agent backend"
              className="shell-docs-radius-surface shell-docs-picker-menu absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto border border-[var(--border)] bg-[var(--bg-surface)] p-2"
            >
              {backendOptions(
                true,
                "hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() =>
              setOpenMenu((menu) => (menu === "backend" ? null : "backend"))
            }
            aria-haspopup="listbox"
            aria-expanded={openMenu === "backend"}
            className={topbarBtnClasses}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
            <span className="truncate">
              {current ? (
                <>
                  <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                    Backend
                  </span>
                  {label}
                </>
              ) : (
                <span className="text-[var(--muted-foreground)]">{label}</span>
              )}
            </span>
            <ChevronDown
              className="h-3 w-3 shrink-0 text-[var(--text-muted)]"
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>

          {openMenu === "backend" && (
            <div
              role="listbox"
              className="shell-docs-radius-surface shell-docs-picker-menu absolute left-0 top-full z-50 mt-1 max-h-[70vh] w-[340px] overflow-y-auto border border-[var(--border)] bg-[var(--bg-surface)] p-2"
            >
              {backendOptions(
                false,
                "hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
