"use client";

// FrameworkSelector - persistent docs selector. The sidebar variant
// exposes frontend and agent backend as separate, simple dropdowns.

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useFramework } from "./framework-provider";
import { FrontendLogo } from "./frontend-logo";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";
import {
  FRONTEND_OPTIONS,
  frontendFromPathname,
  frontendPathFor,
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
   * - `sidebar`: full-width selector rows styled to match the docs sidebar.
   */
  variant?: "topbar" | "sidebar";
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
  // when present, then stored choice, then the soft default.
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
    if (id !== effectiveFrontendId || pathname.startsWith("/frontends/")) {
      router.replace(frontendPathFor(id));
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
    if (pathname.startsWith("/frontends/")) {
      setOpenMenu(null);
      return;
    }
    // Backend changes intentionally drop the current feature slug. The
    // selector is a backend pivot, so landing on the framework root gives
    // readers the overview before framework-specific docs.
    router.replace(`/${slug}`);
    setOpenMenu(null);
  }

  const flatOptions = options
    .filter((opt) => !(isSidebar && opt.slug === "built-in-agent"))
    .slice()
    .sort((a, b) => compareByDisplayOrder(a.slug, b.slug));

  const pinnedBIA = isSidebar
    ? (options.find((o) => o.slug === "built-in-agent") ?? null)
    : null;

  const topbarBtnClasses =
    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] text-[12px] font-medium text-[var(--text)] hover:border-[var(--accent)] transition-colors cursor-pointer max-w-[220px]";

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
          className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            pinnedBIA.slug === effectiveFramework
              ? "bg-[var(--accent-light)] text-[var(--accent)]"
              : `text-[var(--text-secondary)] ${optionHoverClass}`
          }`}
        >
          <FrameworkLogo
            slug={pinnedBIA.slug}
            fallbackSrc={pinnedBIA.logo}
            size={18}
            className="shrink-0"
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
            className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              isActive
                ? "bg-[var(--accent-light)] text-[var(--accent)]"
                : `text-[var(--text-secondary)] ${optionHoverClass}`
            }`}
          >
            <FrameworkLogo
              slug={opt.slug}
              fallbackSrc={opt.logo}
              size={18}
              className="shrink-0"
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
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]/45">
            <button
              type="button"
              onClick={() =>
                setOpenMenu((menu) => (menu === "frontend" ? null : "frontend"))
              }
              aria-haspopup="listbox"
              aria-expanded={openMenu === "frontend"}
              aria-label="Choose frontend"
              className={`flex min-h-14 w-full cursor-pointer items-center gap-2.5 rounded-md p-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                openMenu === "frontend"
                  ? "bg-[var(--accent-light)]"
                  : "hover:bg-[var(--bg-elevated)]"
              }`}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)]"
                aria-hidden="true"
              >
                <FrontendLogo icon={selectedFrontend.icon} size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium leading-tight text-[var(--text-muted)]">
                  Frontend
                </span>
                <span className="mt-0.5 block truncate text-[14px] font-semibold leading-tight text-[var(--text)]">
                  {selectedFrontend.name}
                </span>
              </span>
              <svg
                className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
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
            </button>

            <div className="mx-2 h-px bg-[var(--border)]" />

            <button
              type="button"
              onClick={() =>
                setOpenMenu((menu) => (menu === "backend" ? null : "backend"))
              }
              aria-haspopup="listbox"
              aria-expanded={openMenu === "backend"}
              aria-label="Choose agent backend"
              className={`flex min-h-14 w-full cursor-pointer items-center gap-2.5 rounded-md p-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                openMenu === "backend"
                  ? "bg-[var(--accent-light)]"
                  : "hover:bg-[var(--bg-elevated)]"
              }`}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)]"
                aria-hidden="true"
              >
                {current ? (
                  <FrameworkLogo
                    slug={current.slug}
                    fallbackSrc={current.logo}
                    size={20}
                    className="text-[var(--text)]"
                  />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] opacity-70" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium leading-tight text-[var(--text-muted)]">
                  Agent backend
                </span>
                {current ? (
                  <span className="mt-0.5 block truncate text-[14px] font-semibold leading-tight text-[var(--text)]">
                    {label}
                  </span>
                ) : (
                  <span className="mt-0.5 block truncate text-[14px] font-medium leading-tight text-[var(--text-muted)]">
                    No backend selected
                  </span>
                )}
              </span>
              <svg
                className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
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
            </button>
          </div>

          {openMenu === "frontend" && (
            <div
              role="listbox"
              aria-label="Choose frontend"
              className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-lg"
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
                    className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      isActive
                        ? "bg-[var(--accent-light)] text-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${
                        isActive
                          ? "border-[var(--accent)] bg-[var(--bg-surface)]"
                          : "border-[var(--border)] bg-[var(--bg-elevated)]"
                      }`}
                      aria-hidden="true"
                    >
                      <FrontendLogo icon={option.icon} size={18} />
                    </span>
                    <span className="flex-1 truncate text-left font-medium">
                      {option.name}
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
              className="absolute left-0 top-full z-50 mt-1 w-[320px] max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-lg"
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
          </button>

          {openMenu === "backend" && (
            <div
              role="listbox"
              className="absolute top-full left-0 mt-1 w-[340px] max-h-[70vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg z-50 p-2"
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
