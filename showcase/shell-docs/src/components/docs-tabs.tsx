// <Tabs>/<Tab> — client-side tabs matching reference fumadocs visual.
//
// Usage in MDX:
//     <Tabs items={["JavaScript", "Python"]}>
//       <Tab value="JavaScript">...</Tab>
//       <Tab value="Python">...</Tab>
//     </Tabs>
//
// The reference uses fumadocs' Tabs with a pill-selected active state.
// We reimplement a minimal version so selection + switching works
// without pulling in the full fumadocs-ui package (keeps the shell
// bundle lean and matches our RSC-first MDX flow).

"use client";

import React, {
  useState,
  useMemo,
  useEffect,
  Children,
  isValidElement,
} from "react";

interface TabsProps {
  items?: string[];
  defaultValue?: string;
  children: React.ReactNode;
}

interface TabProps {
  value?: string;
  title?: string;
  children?: React.ReactNode;
}

export function Tabs({ items, defaultValue, children }: TabsProps) {
  // Discover tab labels from children when `items` isn't provided.
  const kids = useMemo(() => {
    const list: { label: string; content: React.ReactNode }[] = [];
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return;
      const props = child.props as TabProps;
      const label = props.value ?? props.title ?? "Tab";
      list.push({ label, content: props.children });
    });
    return list;
  }, [children]);

  const labels = items ?? kids.map((k) => k.label);

  // Warn (dev only) when author-supplied `items` count diverges from the
  // number of <Tab> children — silent drops hide authoring mistakes.
  if (
    process.env.NODE_ENV !== "production" &&
    items &&
    items.length !== kids.length
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[docs-tabs] items.length (${items.length}) !== children count (${kids.length}). Extra entries will be silently dropped.`,
    );
  }

  // Warn (dev only) on duplicate labels — React reconciliation keys on
  // label below, so duplicates corrupt which panel is shown.
  if (process.env.NODE_ENV !== "production") {
    const seen = new Set<string>();
    for (const l of labels) {
      if (seen.has(l)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[docs-tabs] duplicate label "${l}" — labels must be unique.`,
        );
        break;
      }
      seen.add(l);
    }
  }

  const [active, setActive] = useState<string>(
    defaultValue ?? labels[0] ?? "Tab",
  );

  // Re-sync active selection when labels change after mount (e.g. MDX
  // author swapped tab titles, or an HMR edit changed the set). useState
  // only seeds its initial value once, so without this effect an active
  // tab whose label disappeared would leave the panel stuck empty.
  const labelsKey = labels.join("|");
  useEffect(() => {
    if (!labels.includes(active)) {
      setActive(defaultValue ?? labels[0] ?? "Tab");
    }
    // labelsKey intentionally used as a proxy for labels — avoids array
    // identity churn every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelsKey, defaultValue]);

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
        }}
      >
        {labels.map((label, i) => {
          const isActive = label === active;
          return (
            <button
              // Key includes the index so duplicate labels (warned above)
              // don't collide and break React reconciliation.
              key={`${label}-${i}`}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(label)}
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
                transition: "color 120ms, background 120ms",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ padding: "1rem" }}>
        {(() => {
          // Body selection is strictly positional: `labels[i]` is paired
          // with `kids[i]` regardless of whether `labels` came from the
          // `items` prop or was derived from child props. This avoids the
          // items-vs-child-label-mismatch trap (author-supplied `items`
          // rarely match each <Tab>'s `value ?? title ?? "Tab"`) and it
          // also sidesteps duplicate-label double-render — `.find` would
          // at least be single, but pairing by index is the actual
          // contract MDX authors reason about.
          const idx = labels.findIndex((l) => l === active);
          if (idx < 0) return null;
          const kid = kids[idx];
          if (!kid) return null;
          return <React.Fragment key={idx}>{kid.content}</React.Fragment>;
        })()}
      </div>
    </div>
  );
}

export function Tab({ children }: TabProps) {
  // When rendered standalone (outside <Tabs>) just pass through. <Tabs>
  // extracts the `value` prop and children via React traversal above.
  return <>{children}</>;
}
