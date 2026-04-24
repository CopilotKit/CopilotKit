"use client";
/**
 * CollapsibleCategory — wraps content with expand/collapse header.
 *
 * Collapse state is persisted in localStorage using the key
 * `dashboard-collapse-{name}`.
 */
import { useState } from "react";

export interface CollapsibleCategoryProps {
  name: string;
  count: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}

function readStorage(name: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(`dashboard-collapse-${name}`);
    if (stored === "collapsed") return false;
    if (stored === "expanded") return true;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(name: string, open: boolean): void {
  try {
    localStorage.setItem(
      `dashboard-collapse-${name}`,
      open ? "expanded" : "collapsed",
    );
  } catch {
    // localStorage unavailable (SSR, private browsing) — silently ignore.
  }
}

export function CollapsibleCategory({
  name,
  count,
  defaultOpen,
  children,
}: CollapsibleCategoryProps) {
  const [open, setOpen] = useState(() => readStorage(name, defaultOpen));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeStorage(name, next);
  };

  return (
    <div data-testid="collapsible-category">
      <button
        type="button"
        data-testid="collapsible-header"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-2 text-left bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
      >
        <span
          data-testid="collapsible-chevron"
          className={`inline-block text-[10px] text-[var(--text-muted)] transition-transform duration-200 ${open ? "rotate-90" : "rotate-0"}`}
        >
          &#9654;
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          {name}
        </span>
        <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
          {count}
        </span>
      </button>
      {open && children}
    </div>
  );
}
