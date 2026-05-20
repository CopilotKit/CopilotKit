// <Callout> — reference-parity callout boxes.
//
// Visual language matches docs.copilotkit.ai: white card on a 1px border
// with shadow-md, a thin colored left-strip (separate inner element, not
// a border), and an SVG icon next to the bold title row.

import React from "react";
import {
  Info,
  Lightbulb,
  AlertTriangle,
  AlertCircle,
  Pencil,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

const ICON_COMP: Record<CalloutType, LucideIcon> = {
  info: Info,
  tip: Lightbulb,
  warn: AlertTriangle,
  warning: AlertTriangle,
  error: AlertCircle,
  danger: AlertCircle,
  note: Pencil,
};

const PALETTE: Record<CalloutType, { color: string; title: string }> = {
  info: { color: "#6d45f9", title: "Info" },
  tip: { color: "#16a34a", title: "Tip" },
  warn: { color: "#d97706", title: "Warning" },
  warning: { color: "#d97706", title: "Warning" },
  error: { color: "#dc2626", title: "Error" },
  danger: { color: "#dc2626", title: "Danger" },
  note: { color: "#6b7280", title: "Note" },
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  const palette = PALETTE[type] ?? PALETTE.info;
  const Icon = ICON_COMP[type] ?? ICON_COMP.info;
  const heading = title ?? palette.title;

  return (
    <div
      role="note"
      style={{
        display: "flex",
        gap: "0.5rem",
        margin: "1rem 0",
        borderRadius: "0.875rem",
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        padding: "0.75rem",
        paddingLeft: "0.25rem",
        fontSize: "0.875rem",
        color: "var(--text-secondary)",
        boxShadow:
          "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)",
      }}
    >
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: "3px",
          alignSelf: "stretch",
          background: palette.color,
          opacity: 0.5,
          borderRadius: "2px",
          marginRight: "0.5rem",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.25rem",
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          <Icon size={16} style={{ color: palette.color, flexShrink: 0 }} />
          <span>{heading}</span>
        </div>
        <div className="docs-callout-body">{children}</div>
      </div>
    </div>
  );
}
