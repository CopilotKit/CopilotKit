// <FrameworkTabs> — tabbed view of the same region rendered against
// multiple integration frameworks' cells.
//
// Usage (MDX):
//     <FrameworkTabs frameworks={["langgraph-python", "mastra", "crewai-crews"]}>
//       <Snippet framework="langgraph-python" cell="agentic-chat" region="provider-setup" />
//       <Snippet framework="mastra"           cell="agentic-chat" region="provider-setup" />
//       <Snippet framework="crewai-crews"     cell="agentic-chat" region="provider-setup" />
//     </FrameworkTabs>
//
// The authored MDX passes one server-rendered <Snippet> per framework
// as children, in the same order as `frameworks`. Mapping is strictly
// positional (`frameworks[i]` ↔ children[i]), so children counts must
// match `frameworks.length`. When a framework is missing that region
// the Snippet's built-in warning box surfaces inline, so authors still
// get a clear signal to tag the missing region in the corresponding
// cell (and, critically, Snippet emits a non-null element so the
// positional mapping holds).
//
// FrameworkTabs is intentionally **client-side** (uses useState for the
// active tab). The inner <Snippet> is a server component — Next.js will
// transport its rendered HTML across the boundary, which keeps syntax
// highlighting sharp and avoids duplicating the highlight.js dependency
// in the client bundle.

"use client";

import React, { useEffect, useState } from "react";

interface FrameworkTabsProps {
  frameworks: string[];
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

  // Re-sync active selection when `frameworks` changes after mount (e.g.
  // MDX author swapped the framework list, or an HMR edit changed the
  // set). useState only seeds its initial value once, so without this
  // effect an active tab whose slug disappeared from the list would
  // leave the tab highlight blank and every body render null. Mirror
  // the sibling pattern in docs-tabs.tsx.
  const frameworksKey = frameworks.join("|");
  useEffect(() => {
    if (!frameworks.includes(active)) {
      setActive(frameworks[0] ?? "");
    }
    // frameworksKey intentionally used as a proxy for frameworks —
    // avoids array identity churn every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameworksKey]);

  // children should be an array of server-rendered <Snippet> wrappers,
  // one per framework in `frameworks`. We filter + render the active one.
  // This keeps all snippets rendered on the server (good: syntax
  // highlighting) and client only swaps.
  //
  // Filter to valid elements so MDX whitespace text nodes between
  // <Snippet> siblings don't shift the index→framework mapping below.
  const wrapped = React.Children.toArray(children).filter(React.isValidElement);

  // Count mismatch is a hard authoring error: mapping is strictly
  // positional (`frameworks[i]` ↔ `wrapped[i]`), so a Snippet that
  // rendered null (region missing for that framework) would shift every
  // subsequent tab's content onto the wrong framework. Surface in dev
  // and refuse to render misleading content in prod rather than silently
  // display the wrong snippet.
  const countMismatch = wrapped.length !== frameworks.length;
  if (process.env.NODE_ENV !== "production" && countMismatch) {
    // eslint-disable-next-line no-console
    console.warn(
      `[framework-tabs] frameworks.length (${frameworks.length}) !== rendered children (${wrapped.length}). ` +
        `Every framework must emit exactly one child; refusing to render to avoid misaligned tab bodies.`,
    );
  }

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
        {countMismatch
          ? null
          : wrapped.map((child, i) => {
              const fw = frameworks[i];
              if (fw !== active) return null;
              return <React.Fragment key={fw}>{child}</React.Fragment>;
            })}
      </div>
    </div>
  );
}
