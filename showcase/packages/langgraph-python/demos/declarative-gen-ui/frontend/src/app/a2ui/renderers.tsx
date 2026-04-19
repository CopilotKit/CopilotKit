"use client";

/**
 * A2UI catalog RENDERERS.
 *
 * React implementations for each definition in `./definitions.ts`.
 * The assembled catalog (definitions × renderers via `createCatalog`)
 * lives in `./catalog.ts`.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */
import React from "react";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { MyDefinitions } from "./definitions";

const badgePalette: Record<
  "success" | "warning" | "error" | "info",
  { bg: string; fg: string }
> = {
  success: { bg: "#ecfdf5", fg: "#047857" },
  warning: { bg: "#fffbeb", fg: "#b45309" },
  error: { bg: "#fef2f2", fg: "#b91c1c" },
  info: { bg: "#eff6ff", fg: "#1d4ed8" },
};

export const myRenderers: CatalogRenderers<MyDefinitions> = {
  Card: ({ props, children }) => (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 20,
        background: "white",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 260,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontWeight: 600, fontSize: "1rem", color: "#111827" }}>
          {props.title}
        </div>
        {props.subtitle && (
          <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
            {props.subtitle}
          </div>
        )}
      </div>
      {props.child && children(props.child)}
    </div>
  ),

  StatusBadge: ({ props }) => {
    const variant = props.variant ?? "info";
    const { bg, fg } = badgePalette[variant];
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 10px",
          background: bg,
          color: fg,
          borderRadius: 999,
          fontSize: "0.8rem",
          fontWeight: 600,
          letterSpacing: "0.01em",
        }}
      >
        {props.text}
      </span>
    );
  },

  Metric: ({ props }) => {
    const trend = props.trend ?? "neutral";
    const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "";
    const color =
      trend === "up" ? "#059669" : trend === "down" ? "#dc2626" : "#111827";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
          {props.label}
        </div>
        <div
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color,
            display: "flex",
            gap: 6,
            alignItems: "baseline",
          }}
        >
          <span>{props.value}</span>
          {arrow && <span style={{ fontSize: "1rem" }}>{arrow}</span>}
        </div>
      </div>
    );
  },

  InfoRow: ({ props }) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 16,
        paddingTop: 6,
        paddingBottom: 6,
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>
        {props.label}
      </span>
      <span style={{ color: "#111827", fontWeight: 500, fontSize: "0.9rem" }}>
        {props.value}
      </span>
    </div>
  ),

  PrimaryButton: ({ props, dispatch }) => (
    <button
      onClick={() => {
        if (props.action && dispatch) dispatch(props.action);
      }}
      style={{
        padding: "10px 16px",
        borderRadius: 10,
        border: "none",
        background: "#111827",
        color: "white",
        fontWeight: 500,
        fontSize: "0.9rem",
        cursor: "pointer",
      }}
    >
      {props.label}
    </button>
  ),
};
