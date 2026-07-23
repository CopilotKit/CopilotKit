"use client";
/**
 * CollapsibleCategory — headless hook + header-row component for
 * flat table layouts with expand/collapse per category.
 *
 * Collapse state is persisted in localStorage using the key
 * `dashboard-collapse-{name}`.
 */
import { useState, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                               */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  useCollapsible hook                                                */
/* ------------------------------------------------------------------ */

export interface UseCollapsibleOptions {
  name: string;
  defaultOpen: boolean;
}

export interface UseCollapsibleReturn {
  isOpen: boolean;
  toggle: () => void;
}

/**
 * Headless hook for collapse state with localStorage persistence.
 */
export function useCollapsible({
  name,
  defaultOpen,
}: UseCollapsibleOptions): UseCollapsibleReturn {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    setIsOpen(readStorage(name, defaultOpen));
  }, [name, defaultOpen]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    writeStorage(name, next);
  };

  return { isOpen, toggle };
}

/* ------------------------------------------------------------------ */
/*  CategoryHeaderRow — renders the clickable <tr> separator           */
/* ------------------------------------------------------------------ */

export interface CategoryHeaderRowProps {
  name: string;
  count: string;
  colSpan: number;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * A `<tr>` that spans the full table width and acts as a collapsible
 * category separator. Renders a chevron, category name, and count.
 */
export function CategoryHeaderRow({
  name,
  count,
  colSpan,
  isOpen,
  onToggle,
}: CategoryHeaderRowProps) {
  return (
    <tr data-testid="collapsible-category">
      <td colSpan={colSpan} className="p-0">
        <button
          type="button"
          data-testid="collapsible-header"
          onClick={onToggle}
          className="w-full flex items-center gap-2 px-4 py-2 text-left bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
        >
          <span
            data-testid="collapsible-chevron"
            className={`inline-block text-[10px] text-[var(--text-muted)] transition-transform duration-200 ${isOpen ? "rotate-90" : "rotate-0"}`}
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
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Legacy wrapper (backward compat for tests / other consumers)       */
/* ------------------------------------------------------------------ */

export interface CollapsibleCategoryProps {
  name: string;
  count: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}

/**
 * Legacy wrapper that renders a `<div>` with collapse behavior.
 * Prefer useCollapsible + CategoryHeaderRow for flat table layouts.
 */
export function CollapsibleCategory({
  name,
  count,
  defaultOpen,
  children,
}: CollapsibleCategoryProps) {
  const { isOpen, toggle } = useCollapsible({ name, defaultOpen });

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
          className={`inline-block text-[10px] text-[var(--text-muted)] transition-transform duration-200 ${isOpen ? "rotate-90" : "rotate-0"}`}
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
      {isOpen && children}
    </div>
  );
}
