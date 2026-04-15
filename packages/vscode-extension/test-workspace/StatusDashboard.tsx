import { z } from "zod";
import {
  createCatalog,
  type CatalogRenderers,
} from "@copilotkit/a2ui-renderer";
import React from "react";

const definitions = {
  Heading: {
    description: "A section heading with optional subtitle",
    props: z.object({
      text: z.string(),
      subtitle: z.string().optional(),
      level: z.enum(["h1", "h2", "h3"]).optional(),
    }),
  },

  WeatherCard: {
    description: "Weather information card for a city",
    props: z.object({
      city: z.string(),
      temperature: z.string(),
      condition: z.enum(["sunny", "cloudy", "rainy", "snowy", "stormy", "partly-cloudy"]),
      humidity: z.string().optional(),
      wind: z.string().optional(),
      high: z.string().optional(),
      low: z.string().optional(),
    }),
  },

  MetricCard: {
    description: "A KPI metric card with value and trend indicator",
    props: z.object({
      label: z.string(),
      value: z.string(),
      unit: z.string().optional(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: z.string().optional(),
      status: z.enum(["ok", "warning", "error"]).optional(),
    }),
  },

  ProgressBar: {
    description: "A labeled progress bar",
    props: z.object({
      label: z.string(),
      value: z.number(),
      max: z.number().optional(),
      color: z.string().optional(),
    }),
  },

  Alert: {
    description: "An alert or notification banner",
    props: z.object({
      message: z.string(),
      severity: z.enum(["info", "success", "warning", "error"]),
    }),
  },

  Badge: {
    description: "A small status badge",
    props: z.object({
      text: z.string(),
      variant: z.enum(["success", "warning", "error", "info", "neutral"]).optional(),
    }),
  },

  DataTable: {
    description: "A data table with columns and rows",
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.string())),
    }),
  },

  InfoList: {
    description: "A list of key-value pairs",
    props: z.object({
      items: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  },
};

// --- Styles ---

const font = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const weatherIcons: Record<string, string> = {
  sunny: "\u2600\uFE0F",
  cloudy: "\u2601\uFE0F",
  rainy: "\uD83C\uDF27\uFE0F",
  snowy: "\u2744\uFE0F",
  stormy: "\u26C8\uFE0F",
  "partly-cloudy": "\u26C5",
};

const trendIcons: Record<string, { icon: string; color: string }> = {
  up: { icon: "\u2191", color: "#22c55e" },
  down: { icon: "\u2193", color: "#ef4444" },
  neutral: { icon: "\u2192", color: "#a3a3a3" },
};

const statusColors: Record<string, string> = {
  ok: "#22c55e",
  warning: "#eab308",
  error: "#ef4444",
};

const severityStyles: Record<string, { bg: string; border: string; text: string }> = {
  info: { bg: "#1e3a5f", border: "#3b82f6", text: "#93c5fd" },
  success: { bg: "#14532d", border: "#22c55e", text: "#86efac" },
  warning: { bg: "#422006", border: "#eab308", text: "#fde047" },
  error: { bg: "#450a0a", border: "#ef4444", text: "#fca5a5" },
};

const badgeColors: Record<string, { bg: string; text: string }> = {
  success: { bg: "#166534", text: "#86efac" },
  warning: { bg: "#854d0e", text: "#fde047" },
  error: { bg: "#991b1b", text: "#fca5a5" },
  info: { bg: "#1e3a5f", text: "#93c5fd" },
  neutral: { bg: "#404040", text: "#d4d4d4" },
};

// --- Renderers ---

const renderers: CatalogRenderers<typeof definitions> = {
  Heading: ({ props }) => {
    const Tag = (props.level ?? "h2") as keyof React.JSX.IntrinsicElements;
    return (
      <div style={{ marginBottom: "4px", fontFamily: font }}>
        <Tag style={{ margin: "0 0 4px 0", color: "#e5e5e5", fontWeight: 600 }}>
          {props.text}
        </Tag>
        {props.subtitle && (
          <p style={{ margin: 0, fontSize: "13px", color: "#a3a3a3" }}>
            {props.subtitle}
          </p>
        )}
      </div>
    );
  },

  WeatherCard: ({ props }) => {
    const icon = weatherIcons[props.condition] ?? "\uD83C\uDF24\uFE0F";
    return (
      <div
        style={{
          background: "linear-gradient(135deg, #1e293b, #0f172a)",
          border: "1px solid #334155",
          borderRadius: "12px",
          padding: "20px",
          fontFamily: font,
          color: "#e2e8f0",
          minWidth: "200px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "14px", color: "#94a3b8", marginBottom: "4px" }}>{props.city}</div>
            <div style={{ fontSize: "36px", fontWeight: 700, lineHeight: 1 }}>{props.temperature}</div>
          </div>
          <div style={{ fontSize: "48px", lineHeight: 1 }}>{icon}</div>
        </div>
        <div style={{ fontSize: "13px", color: "#94a3b8", marginTop: "12px", textTransform: "capitalize" }}>
          {props.condition.replace("-", " ")}
        </div>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px", fontSize: "12px", color: "#64748b" }}>
          {props.humidity && <span>\uD83D\uDCA7 {props.humidity}</span>}
          {props.wind && <span>\uD83C\uDF2C\uFE0F {props.wind}</span>}
          {props.high && props.low && (
            <span>H: {props.high} / L: {props.low}</span>
          )}
        </div>
      </div>
    );
  },

  MetricCard: ({ props }) => {
    const trend = props.trend ? trendIcons[props.trend] : null;
    const borderColor = props.status ? statusColors[props.status] : "#334155";
    return (
      <div
        style={{
          background: "#1e1e1e",
          border: `1px solid ${borderColor}`,
          borderRadius: "10px",
          padding: "16px 20px",
          fontFamily: font,
          minWidth: "160px",
        }}
      >
        <div style={{ fontSize: "12px", color: "#a3a3a3", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {props.label}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
          <span style={{ fontSize: "28px", fontWeight: 700, color: "#e5e5e5" }}>{props.value}</span>
          {props.unit && <span style={{ fontSize: "14px", color: "#737373" }}>{props.unit}</span>}
        </div>
        {trend && props.trendValue && (
          <div style={{ marginTop: "8px", fontSize: "13px", color: trend.color, display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "16px" }}>{trend.icon}</span>
            {props.trendValue}
          </div>
        )}
      </div>
    );
  },

  ProgressBar: ({ props }) => {
    const max = props.max ?? 100;
    const pct = Math.min(100, (props.value / max) * 100);
    const color = props.color ?? (pct > 80 ? "#ef4444" : pct > 60 ? "#eab308" : "#22c55e");
    return (
      <div style={{ fontFamily: font, marginBottom: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "4px" }}>
          <span style={{ color: "#d4d4d4" }}>{props.label}</span>
          <span style={{ color: "#a3a3a3" }}>{props.value}/{max}</span>
        </div>
        <div style={{ background: "#262626", borderRadius: "4px", height: "8px", overflow: "hidden" }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: color,
              borderRadius: "4px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>
    );
  },

  Alert: ({ props }) => {
    const style = severityStyles[props.severity] ?? severityStyles.info;
    const icons: Record<string, string> = {
      info: "\u2139\uFE0F",
      success: "\u2705",
      warning: "\u26A0\uFE0F",
      error: "\u274C",
    };
    return (
      <div
        style={{
          background: style.bg,
          border: `1px solid ${style.border}`,
          borderRadius: "8px",
          padding: "12px 16px",
          fontFamily: font,
          fontSize: "13px",
          color: style.text,
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <span style={{ fontSize: "16px" }}>{icons[props.severity]}</span>
        {props.message}
      </div>
    );
  },

  Badge: ({ props }) => {
    const colors = badgeColors[props.variant ?? "neutral"];
    return (
      <span
        style={{
          display: "inline-block",
          background: colors.bg,
          color: colors.text,
          borderRadius: "9999px",
          padding: "2px 10px",
          fontSize: "11px",
          fontWeight: 600,
          fontFamily: font,
          letterSpacing: "0.3px",
        }}
      >
        {props.text}
      </span>
    );
  },

  DataTable: ({ props }) => (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: font,
        fontSize: "13px",
      }}
    >
      <thead>
        <tr>
          {props.columns.map((col) => (
            <th
              key={col.key}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderBottom: "2px solid #334155",
                color: "#a3a3a3",
                fontWeight: 600,
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, i) => (
          <tr key={i}>
            {props.columns.map((col) => (
              <td
                key={col.key}
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid #262626",
                  color: "#d4d4d4",
                }}
              >
                {row[col.key] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),

  InfoList: ({ props }) => (
    <div style={{ fontFamily: font, fontSize: "13px" }}>
      {props.items.map((item, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom: i < props.items.length - 1 ? "1px solid #262626" : "none",
          }}
        >
          <span style={{ color: "#a3a3a3" }}>{item.key}</span>
          <span style={{ color: "#e5e5e5", fontWeight: 500 }}>{item.value}</span>
        </div>
      ))}
    </div>
  ),
};

export const catalog = createCatalog(definitions, renderers, {
  catalogId: "copilotkit://test-status-dashboard",
  includeBasicCatalog: true,
});

export default catalog;
