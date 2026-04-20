"use client";

// FrameworkSelector — persistent "agentic backend" dropdown that anchors
// the docs experience. Opens a panel listing every registry integration
// grouped by category. Selecting an entry navigates to
// `/<framework>/<current-feature>` when the page is framework-scopable,
// otherwise to `/<framework>` (the framework's landing page, which is
// itself a docs route under the catch-all).

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFramework } from "./framework-provider";

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
 */
function stripFrameworkPrefix(
  pathname: string,
  knownFrameworks: string[],
): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
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
  const { framework, knownFrameworks, setStoredFramework } = useFramework();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside-click / Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
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

  const current = options.find((o) => o.slug === framework);
  const label = current?.name ?? "Pick an agentic backend";

  // Compute the target href for a given framework option given the current
  // path. Preserves feature slug when possible.
  function hrefFor(slug: string): string {
    // Case 1: currently on /<existing-framework>/<rest>
    const frameworkTail = stripFrameworkPrefix(pathname, knownFrameworks);
    if (frameworkTail !== null) {
      return frameworkTail ? `/${slug}/${frameworkTail}` : `/${slug}`;
    }
    // Case 2: currently on /docs/<rest> — switch to framework-scoped
    const docsTail = stripDocsPrefix(pathname);
    if (docsTail !== null && docsTail.length > 0) {
      return `/${slug}/${docsTail}`;
    }
    // Fallback: framework landing page
    return `/${slug}`;
  }

  function selectFramework(slug: string) {
    setStoredFramework(slug);
    router.push(hrefFor(slug));
    setOpen(false);
  }

  // Group options by category while preserving the category order declared
  // in the registry.
  const grouped = new Map<string, FrameworkOption[]>();
  for (const cat of categoryOrder) grouped.set(cat.id, []);
  grouped.set("other", []);
  for (const opt of options) {
    const bucket = grouped.has(opt.category) ? opt.category : "other";
    grouped.get(bucket)!.push(opt);
  }

  const isSidebar = variant === "sidebar";

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
            {current?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.logo} alt="" className="w-5 h-5 shrink-0" />
            ) : (
              <span
                className="w-5 h-5 shrink-0 rounded-full bg-[var(--accent)] opacity-70"
                aria-hidden="true"
              />
            )}
            <span className="flex-1 min-w-0 text-left">
              {current ? (
                <span className="block truncate">{current.name}</span>
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
          {framework && (
            <button
              type="button"
              className="w-full text-left px-2 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              onClick={() => {
                setStoredFramework(null);
                // Navigate to the equivalent /docs/<feature> page when we can
                const frameworkTail = stripFrameworkPrefix(
                  pathname,
                  knownFrameworks,
                );
                if (frameworkTail !== null) {
                  router.push(
                    frameworkTail ? `/docs/${frameworkTail}` : "/docs",
                  );
                }
                setOpen(false);
              }}
            >
              Clear selection
            </button>
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
                  const isActive = opt.slug === framework;
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
                      {opt.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={opt.logo}
                          alt=""
                          className="w-4 h-4 shrink-0"
                        />
                      ) : (
                        <span className="w-4 h-4 shrink-0" />
                      )}
                      <span className="flex-1 text-left truncate">
                        {opt.name}
                      </span>
                      {!opt.deployed && (
                        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-faint)]">
                          soon
                        </span>
                      )}
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
