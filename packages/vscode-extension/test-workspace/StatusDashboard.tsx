/**
 * Example A2UI catalog component for testing the VS Code extension preview.
 *
 * Open this workspace in the Extension Development Host (F5) to test:
 * 1. CopilotKit icon appears in Activity Bar
 * 2. This component appears in the sidebar tree
 * 3. Clicking it opens a preview panel
 * 4. Editing this file triggers a hot-reload
 */

import { z } from "zod";
import { createCatalog, type CatalogRenderers } from "@copilotkit/a2ui-renderer";
import React from "react";

// -- Definitions (Zod schemas) --

const definitions = {
  Heading: {
    description: "A section heading",
    props: z.object({
      text: z.string(),
      level: z.enum(["h1", "h2", "h3"]).optional(),
    }),
  },

  StatusCard: {
    description: "A card showing a metric with a status indicator",
    props: z.object({
      label: z.string(),
      value: z.string(),
      status: z.enum(["ok", "warning", "error"]).optional(),
    }),
  },

  InfoList: {
    description: "A simple list of key-value pairs",
    props: z.object({
      items: z.array(
        z.object({
          key: z.string(),
          value: z.string(),
        }),
      ),
    }),
  },
};

// -- Renderers (React components) --

const statusColors = {
  ok: "#22c55e",
  warning: "#eab308",
  error: "#ef4444",
};

const renderers: CatalogRenderers<typeof definitions> = {
  Heading: ({ props }) => {
    const Tag = (props.level ?? "h2") as keyof JSX.IntrinsicElements;
    return <Tag style={{ margin: "8px 0", fontFamily: "sans-serif" }}>{props.text}</Tag>;
  },

  StatusCard: ({ props }) => {
    const color = statusColors[props.status ?? "ok"];
    return (
      <div
        style={{
          border: `2px solid ${color}`,
          borderRadius: "8px",
          padding: "16px",
          margin: "8px 0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: "12px", opacity: 0.7 }}>{props.label}</div>
        <div style={{ fontSize: "24px", fontWeight: "bold" }}>{props.value}</div>
        <div
          style={{
            display: "inline-block",
            background: color,
            color: "white",
            borderRadius: "4px",
            padding: "2px 8px",
            fontSize: "11px",
            marginTop: "4px",
          }}
        >
          {props.status ?? "ok"}
        </div>
      </div>
    );
  },

  InfoList: ({ props }) => (
    <ul style={{ fontFamily: "sans-serif", listStyle: "none", padding: 0 }}>
      {props.items.map((item, i) => (
        <li key={i} style={{ padding: "4px 0", borderBottom: "1px solid #333" }}>
          <strong>{item.key}:</strong> {item.value}
        </li>
      ))}
    </ul>
  ),
};

// -- Export the catalog --

export const catalog = createCatalog(definitions, renderers, {
  catalogId: "copilotkit://test-status-dashboard",
});

export default catalog;
