// <FrameworkTabs> — tabbed view of the same region rendered against
// multiple integration frameworks' cells.
//
// Usage:
//     <FrameworkTabs
//       frameworks={["langgraph-python", "mastra", "crewai-crews"]}
//       cell="agentic-chat"
//       region="provider-setup"
//     />
//
// Each tab runs <Snippet framework=... cell=... region=...>. When a
// framework is missing that region/cell the Snippet's built-in warning
// box surfaces inline, so authors get a clear signal to tag the missing
// region in the corresponding cell.
//
// FrameworkTabs is intentionally **client-side** (uses useState for the
// active tab). The inner <Snippet> is a server component — Next.js will
// transport its rendered HTML across the boundary, which keeps syntax
// highlighting sharp and avoids duplicating the highlight.js dependency
// in the client bundle.

"use client";

import React, { useState } from "react";

interface FrameworkTabsProps {
  frameworks: string[];
  cell: string;
  region: string;
  /** Render an alternative label for each framework (e.g. pretty names). */
  labels?: Record<string, string>;
  /** Pre-rendered <Snippet> content, keyed by framework slug. Populated by
   *  the parent MDX renderer which walks the `frameworks` list and emits
   *  a Snippet per framework on the server side. */
  children: React.ReactNode;
}

export function FrameworkTabs({
  frameworks,
  labels,
  children,
}: FrameworkTabsProps) {
  const [active, setActive] = useState<string>(frameworks[0] ?? "");

  // children should be an array of <div data-framework="..."> wrappers.
  // We filter + render the active one. This keeps all snippets rendered
  // on the server (good: syntax highlighting) and client only swaps.
  const wrapped = React.Children.toArray(children);

  const displayLabel = (slug: string) =>
    labels?.[slug] ??
    slug
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");

  return (
    <div className="shell-docs-radius-surface my-4 mb-5 overflow-hidden border border-[var(--border)] bg-[var(--card)]">
      <div
        role="tablist"
        className="flex flex-wrap gap-1 border-b border-[var(--border)] bg-[var(--secondary)] px-2 pt-1.5"
      >
        {frameworks.map((fw) => {
          const isActive = fw === active;
          return (
            <button
              key={fw}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(fw)}
              className={[
                "cursor-pointer border-0 border-b-2 px-3.5 py-2 text-[0.8125rem] [border-radius:var(--shell-docs-radius-control)_var(--shell-docs-radius-control)_0_0]",
                isActive
                  ? "border-[var(--brand-accent)] bg-[var(--card)] font-semibold text-[var(--foreground)]"
                  : "border-transparent bg-transparent font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent-dim)] hover:text-[var(--brand-accent)]",
              ].join(" ")}
            >
              {displayLabel(fw)}
            </button>
          );
        })}
      </div>
      <div>
        {wrapped.map((child, i) => {
          const fw = frameworks[i];
          if (fw !== active) return null;
          return <React.Fragment key={fw}>{child}</React.Fragment>;
        })}
      </div>
    </div>
  );
}
