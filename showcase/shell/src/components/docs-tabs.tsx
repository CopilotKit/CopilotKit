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

import React, { useState, useMemo, Children, isValidElement } from "react";

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
  const [active, setActive] = useState<string>(
    defaultValue ?? labels[0] ?? "Tab",
  );

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
        {labels.map((label) => {
          const isActive = label === active;
          return (
            <button
              key={label}
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
        {kids
          .filter((k) => k.label === active)
          .map((k, i) => (
            <React.Fragment key={i}>{k.content}</React.Fragment>
          ))}
      </div>
    </div>
  );
}

export function Tab({ children }: TabProps) {
  // When rendered standalone (outside <Tabs>) just pass through. <Tabs>
  // extracts the `value` prop and children via React traversal above.
  return <>{children}</>;
}
