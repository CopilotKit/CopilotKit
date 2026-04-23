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
    description: "Weather information card for a city (Tailwind)",
    props: z.object({
      city: z.string(),
      temperature: z.string(),
      condition: z.enum([
        "sunny",
        "cloudy",
        "rainy",
        "snowy",
        "stormy",
        "partly-cloudy",
      ]),
      humidity: z.string().optional(),
      wind: z.string().optional(),
      high: z.string().optional(),
      low: z.string().optional(),
    }),
  },

  MetricCard: {
    description: "A KPI metric card with value and trend indicator (Tailwind)",
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
    description: "A labeled progress bar (Tailwind)",
    props: z.object({
      label: z.string(),
      value: z.number(),
      max: z.number().optional(),
      color: z.string().optional(),
    }),
  },

  Alert: {
    description: "An alert or notification banner (inline styles)",
    props: z.object({
      message: z.string(),
      severity: z.enum(["info", "success", "warning", "error"]),
    }),
  },

  Badge: {
    description: "A small status badge (inline styles)",
    props: z.object({
      text: z.string(),
      variant: z
        .enum(["success", "warning", "error", "info", "neutral"])
        .optional(),
    }),
  },

  DataTable: {
    description: "A data table with columns and rows (inline styles)",
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.string())),
    }),
  },

  InfoList: {
    description: "A list of key-value pairs (Tailwind)",
    props: z.object({
      items: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  },
};

// --- Weather icons ---

const weatherIcons: Record<string, string> = {
  sunny: "\u2600\uFE0F",
  cloudy: "\u2601\uFE0F",
  rainy: "\uD83C\uDF27\uFE0F",
  snowy: "\u2744\uFE0F",
  stormy: "\u26C8\uFE0F",
  "partly-cloudy": "\u26C5",
};

// --- Inline-style constants (for non-Tailwind components) ---

const font = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const severityStyles: Record<
  string,
  { bg: string; border: string; text: string }
> = {
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
  // =============================================
  // INLINE STYLES — Heading, Alert, Badge, DataTable
  // =============================================

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

  Alert: ({ props }) => {
    const s = severityStyles[props.severity] ?? severityStyles.info;
    const icons: Record<string, string> = {
      info: "\u2139\uFE0F",
      success: "\u2705",
      warning: "\u26A0\uFE0F",
      error: "\u274C",
    };
    return (
      <div
        style={{
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderRadius: "8px",
          padding: "12px 16px",
          fontFamily: font,
          fontSize: "13px",
          color: s.text,
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
    const c = badgeColors[props.variant ?? "neutral"];
    return (
      <span
        style={{
          display: "inline-block",
          background: c.bg,
          color: c.text,
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

  // =============================================
  // TAILWIND — WeatherCard, MetricCard, ProgressBar, InfoList
  // =============================================

  WeatherCard: ({ props }) => {
    const icon = weatherIcons[props.condition] ?? "\uD83C\uDF24\uFE0F";
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-5 text-slate-200 min-w-[200px]">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-sm text-slate-400 mb-1">{props.city}</div>
            <div className="text-4xl font-bold leading-none">
              {props.temperature}
            </div>
          </div>
          <div className="text-5xl leading-none">{icon}</div>
        </div>
        <div className="text-sm text-slate-400 mt-3 capitalize">
          {props.condition.replace("-", " ")}
        </div>
        <div className="flex gap-4 mt-2 text-xs text-slate-500">
          {props.humidity && (
            <span>
              {"\uD83D\uDCA7"} {props.humidity}
            </span>
          )}
          {props.wind && (
            <span>
              {"\uD83C\uDF2C\uFE0F"} {props.wind}
            </span>
          )}
          {props.high && props.low && (
            <span>
              H: {props.high} / L: {props.low}
            </span>
          )}
        </div>
      </div>
    );
  },

  MetricCard: ({ props }) => {
    const trendClasses: Record<string, string> = {
      up: "text-green-400",
      down: "text-red-400",
      neutral: "text-neutral-400",
    };
    const trendArrows: Record<string, string> = {
      up: "\u2191",
      down: "\u2193",
      neutral: "\u2192",
    };
    const borderClasses: Record<string, string> = {
      ok: "border-green-500",
      warning: "border-yellow-500",
      error: "border-red-500",
    };
    const borderClass = props.status
      ? borderClasses[props.status]
      : "border-neutral-700";
    return (
      <div
        className={`bg-neutral-900 border ${borderClass} rounded-lg px-5 py-4 min-w-[160px]`}
      >
        <div className="text-xs text-neutral-400 mb-2 uppercase tracking-wide">
          {props.label}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-neutral-100">
            {props.value}
          </span>
          {props.unit && (
            <span className="text-sm text-neutral-500">{props.unit}</span>
          )}
        </div>
        {props.trend && props.trendValue && (
          <div
            className={`mt-2 text-sm flex items-center gap-1 ${trendClasses[props.trend]}`}
          >
            <span className="text-base">{trendArrows[props.trend]}</span>
            {props.trendValue}
          </div>
        )}
      </div>
    );
  },

  ProgressBar: ({ props }) => {
    const max = props.max ?? 100;
    const pct = Math.min(100, (props.value / max) * 100);
    const barColor =
      props.color ??
      (pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500");
    return (
      <div className="mb-2">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-neutral-300">{props.label}</span>
          <span className="text-neutral-500">
            {props.value}/{max}
          </span>
        </div>
        <div className="bg-neutral-800 rounded h-2 overflow-hidden">
          <div
            className={`h-full rounded transition-all duration-300 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  },

  InfoList: ({ props }) => (
    <div className="text-sm">
      {props.items.map((item, i) => (
        <div
          key={i}
          className={`flex justify-between py-2 ${i < props.items.length - 1 ? "border-b border-neutral-800" : ""}`}
        >
          <span className="text-neutral-400">{item.key}</span>
          <span className="text-neutral-100 font-medium">{item.value}</span>
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
