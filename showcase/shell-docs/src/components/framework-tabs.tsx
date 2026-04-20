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
    <div
      style={{
        margin: "1rem 0 1.25rem 0",
        borderRadius: "0.5rem",
        border: "1px solid var(--border)",
        overflow: "hidden",
        background: "var(--bg-surface)",
      }}
    >
      <div
        role="tablist"
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          padding: "0.375rem 0.5rem 0 0.5rem",
          gap: "0.25rem",
          flexWrap: "wrap",
        }}
      >
        {frameworks.map((fw) => {
          const isActive = fw === active;
          return (
            <button
              key={fw}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(fw)}
              style={{
                padding: "0.5rem 0.875rem",
                fontSize: "0.8125rem",
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--text)" : "var(--text-muted)",
                background: isActive ? "var(--bg-surface)" : "transparent",
                borderRadius: "0.375rem 0.375rem 0 0",
                border: "none",
                borderBottom: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                cursor: "pointer",
              }}
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
