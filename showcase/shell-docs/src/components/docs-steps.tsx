// <Steps>/<Step> — numbered step blocks with a left-side connector line.
//
// Reference (docs.copilotkit.ai) uses fumadocs' `Steps`: each step is
// numbered via a small circle on the left and a thin vertical line
// connects consecutive steps. We approximate that here in pure CSS —
// no client-side JS needed, so this works inside RSC-rendered MDX.

import React from "react";

export function Steps({ children }: { children: React.ReactNode }) {
  // Walk children and wrap each Step with its auto-assigned number.
  const items = React.Children.toArray(children).filter((c) =>
    React.isValidElement(c),
  );
  const numbered = items.map((child, idx) =>
    React.isValidElement(child)
      ? React.cloneElement(child as React.ReactElement<StepProps>, {
          __index: idx + 1,
          __total: items.length,
        })
      : child,
  );
  return (
    <div
      style={{
        position: "relative",
        paddingLeft: "2rem",
        borderLeft: "1px solid var(--border)",
        marginLeft: "0.75rem",
        margin: "1.5rem 0 1.5rem 0.75rem",
      }}
    >
      {numbered}
    </div>
  );
}

interface StepProps {
  title?: string;
  children?: React.ReactNode;
  __index?: number;
  __total?: number;
}

export function Step({ title, children, __index, __total }: StepProps) {
  const isLast =
    __index !== undefined && __total !== undefined && __index === __total;
  return (
    <div
      style={{
        position: "relative",
        paddingBottom: isLast ? "0" : "1.5rem",
        marginBottom: isLast ? "0" : "0",
      }}
    >
      {/* numbered badge */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "-2.75rem",
          top: "-0.125rem",
          width: "1.5rem",
          height: "1.5rem",
          borderRadius: "999px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          fontSize: "0.75rem",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        {__index ?? ""}
      </div>
      {title && (
        <h4
          style={{
            fontWeight: 600,
            marginBottom: "0.375rem",
            marginTop: 0,
            fontSize: "1rem",
            color: "var(--text)",
          }}
        >
          {title}
        </h4>
      )}
      <div style={{ fontSize: "0.9375rem", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}
