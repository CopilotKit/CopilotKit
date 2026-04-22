// <Callout> — reference-parity callout boxes.
//
// Matches the fumadocs "Callout" component visually: left-border tint,
// muted bg, type icon, semibold title row, and relaxed prose below.
// Supported types: info, tip, warn, warning, danger, error, note.

import React from "react";

type CalloutType =
  | "info"
  | "tip"
  | "warn"
  | "warning"
  | "error"
  | "danger"
  | "note";

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}

const ICON: Record<string, string> = {
  info: "i",
  tip: "\u2728",
  warn: "!",
  warning: "!",
  error: "\u2715",
  danger: "\u2715",
  note: "\u270E",
};

const PALETTE: Record<
  string,
  { border: string; bg: string; icon: string; title: string }
> = {
  info: {
    border: "#5a3cd1",
    bg: "rgba(90, 60, 209, 0.06)",
    icon: "#5a3cd1",
    title: "Info",
  },
  tip: {
    border: "#16a34a",
    bg: "rgba(22, 163, 74, 0.06)",
    icon: "#16a34a",
    title: "Tip",
  },
  warn: {
    border: "#d97706",
    bg: "rgba(217, 119, 6, 0.06)",
    icon: "#d97706",
    title: "Warning",
  },
  warning: {
    border: "#d97706",
    bg: "rgba(217, 119, 6, 0.06)",
    icon: "#d97706",
    title: "Warning",
  },
  error: {
    border: "#dc2626",
    bg: "rgba(220, 38, 38, 0.06)",
    icon: "#dc2626",
    title: "Error",
  },
  danger: {
    border: "#dc2626",
    bg: "rgba(220, 38, 38, 0.06)",
    icon: "#dc2626",
    title: "Danger",
  },
  note: {
    border: "#6b7280",
    bg: "rgba(107, 114, 128, 0.06)",
    icon: "#6b7280",
    title: "Note",
  },
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  // Warn (dev only) when an unknown type slips past TS — e.g. from MDX
  // authors passing a raw string. Silent fallback to `info` masks typos.
  if (
    process.env.NODE_ENV !== "production" &&
    !Object.prototype.hasOwnProperty.call(PALETTE, type)
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[docs-callout] unknown type "${type}" — falling back to "info". Known types: ${Object.keys(PALETTE).join(", ")}`,
    );
  }
  const palette = PALETTE[type] ?? PALETTE.info;
  const icon = ICON[type] ?? ICON.info;
  const heading = title ?? palette.title;

  return (
    <div
      role="note"
      style={{
        borderLeft: `3px solid ${palette.border}`,
        background: palette.bg,
        padding: "0.875rem 1rem",
        borderRadius: "0.375rem",
        margin: "1.25rem 0",
        fontSize: "0.9375rem",
        color: "var(--text-secondary)",
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.375rem",
          fontWeight: 600,
          color: "var(--text)",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.125rem",
            height: "1.125rem",
            borderRadius: "999px",
            background: palette.icon,
            color: "#fff",
            fontSize: "0.6875rem",
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
        {heading}
      </div>
      <div className="docs-callout-body">{children}</div>
    </div>
  );
}
