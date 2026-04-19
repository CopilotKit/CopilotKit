"use client";

/**
 * A2UI Catalog — Declarative (Dynamic Schema) demo.
 *
 * Unlike the fixed-schema flavor (where the component tree is pre-defined),
 * the agent here *generates* the component tree at runtime. We still register
 * a small set of custom components so the agent can pick from them when it
 * composes a surface, and we flip on `includeBasicCatalog` so the built-in
 * A2UI primitives (Text, Row, Column, Image, …) come along for free.
 *
 * Pattern reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */

import React from "react";
import { z } from "zod";
import {
  createCatalog,
  type CatalogDefinitions,
  type CatalogRenderers,
} from "@copilotkit/a2ui-renderer";

// ─── Definitions ───────────────────────────────────────────────────────
//
// Zod schemas + short descriptions. These travel to the agent as context so
// it knows which custom components are available alongside the basic catalog.

const demoDefinitions = {
  Card: {
    description:
      "A card container with a title and a single child slot. Use for grouping related content.",
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      child: z.string().optional(),
    }),
  },

  Title: {
    description: "A heading for a section or surface.",
    props: z.object({
      text: z.string(),
      level: z.enum(["1", "2", "3"]).optional(),
    }),
  },

  Metric: {
    description:
      "A key metric display with a label and value. Great for KPIs and dashboards.",
    props: z.object({
      label: z.string(),
      value: z.string(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
    }),
  },

  PrimaryButton: {
    description:
      "A styled call-to-action button. Dispatch the action on click.",
    props: z.object({
      label: z.string(),
      action: z.any().optional(),
    }),
  },
} satisfies CatalogDefinitions;

type DemoDefinitions = typeof demoDefinitions;

// ─── Renderers ─────────────────────────────────────────────────────────
//
// React implementations. Props are type-checked against the Zod schemas.

const demoRenderers: CatalogRenderers<DemoDefinitions> = {
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
        <div style={{ fontWeight: 600, fontSize: "1rem" }}>{props.title}</div>
        {props.subtitle && (
          <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
            {props.subtitle}
          </div>
        )}
      </div>
      {props.child && children(props.child)}
    </div>
  ),

  Title: ({ props }) => {
    const level = props.level ?? "2";
    const size =
      level === "1" ? "1.5rem" : level === "2" ? "1.25rem" : "1.05rem";
    return (
      <div style={{ fontWeight: 700, fontSize: size, color: "#111827" }}>
        {props.text}
      </div>
    );
  },

  Metric: ({ props }) => {
    const trend = props.trend ?? "neutral";
    const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "";
    const color =
      trend === "up" ? "#059669" : trend === "down" ? "#dc2626" : "#374151";
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

// ─── Assembled Catalog ─────────────────────────────────────────────────

export const demoCatalog = createCatalog(demoDefinitions, demoRenderers, {
  catalogId: "copilotkit://declarative-gen-ui-demo-catalog",
  // Merge the built-in A2UI basic catalog so the agent can also use
  // Text, Row, Column, Image, etc. when composing its dynamic schema.
  includeBasicCatalog: true,
});
