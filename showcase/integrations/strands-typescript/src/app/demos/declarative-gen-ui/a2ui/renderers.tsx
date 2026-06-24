"use client";

/**
 * A2UI catalog RENDERERS.
 *
 * React implementations for each definition in `./definitions.ts`. Visuals
 * mirror beautiful-chat's sales dashboard renderers
 * (../../beautiful-chat/declarative-generative-ui/renderers.tsx) so the two
 * demos read as the same product family — same card chrome, metric
 * typography, recharts donut/bar styling, and palette. The assembled catalog
 * (definitions × renderers via `createCatalog`) lives in `./catalog.ts`.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */
import React from "react";
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";
import { TriangleAlert, CircleAlert, CircleCheck, Info } from "lucide-react";

import type { MyDefinitions } from "./definitions";
import { Badge } from "../_components/badge";
import { Button } from "../_components/button";

// ─── Theme tokens + palette (mirrors beautiful-chat) ────────────────────────
const c = {
  card: "var(--card)",
  cardFg: "var(--card-foreground)",
  border: "var(--border)",
  muted: "var(--muted-foreground)",
  divider: "color-mix(in srgb, var(--border) 50%, var(--card))",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
};

const CHART_COLORS = [
  "#3b82f6", // blue-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#6366f1", // indigo-500
] as const;

/** DashboardCard-style chrome shared by Card and the chart wrappers. */
function CardShell({
  title,
  subtitle,
  testid,
  cardId,
  children,
}: {
  title: string;
  subtitle?: string;
  testid?: string;
  cardId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      data-card-id={cardId}
      style={{
        background: c.card,
        borderRadius: "12px",
        border: `1px solid ${c.border}`,
        padding: "20px",
        boxShadow: c.shadow,
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.9rem", color: c.cardFg }}>
          {title}
        </div>
        {subtitle && (
          <div
            style={{ fontSize: "0.75rem", color: c.muted, marginTop: "2px" }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// @region[renderers-react]
export const myRenderers: CatalogRenderers<MyDefinitions> = {
  Row: ({ props, children }) => {
    const justifyMap: Record<string, string> = {
      start: "flex-start",
      center: "center",
      end: "flex-end",
      spaceBetween: "space-between",
    };
    const items = Array.isArray(props.children) ? props.children : [];
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: `${props.gap ?? 16}px`,
          alignItems: props.align ?? "stretch",
          justifyContent: justifyMap[props.justify ?? "start"] ?? "flex-start",
          flexWrap: "wrap",
          width: "100%",
        }}
      >
        {items.map((id, i) => (
          <div key={`${id}-${i}`} style={{ flex: "1 1 0", minWidth: 0 }}>
            {children(id)}
          </div>
        ))}
      </div>
    );
  },

  Column: ({ props, children }) => {
    const items = Array.isArray(props.children) ? props.children : [];
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: `${props.gap ?? 12}px`,
          width: "100%",
        }}
      >
        {items.map((id, i) => (
          <React.Fragment key={`${id}-${i}`}>{children(id)}</React.Fragment>
        ))}
      </div>
    );
  },

  Text: ({ props }) => (
    <span style={{ fontSize: "0.85rem", color: c.cardFg, lineHeight: 1.5 }}>
      {props.text}
    </span>
  ),

  Card: ({ props, children }) => (
    // `data-testid="declarative-card"` stays shared so existing e2e selectors
    // still find every card; `data-card-id={props.title}` disambiguates
    // sibling cards (e.g. the at-risk pill's 3 severity cards) so test
    // assertions can target a specific card by title.
    <CardShell
      title={props.title}
      subtitle={props.subtitle}
      testid="declarative-card"
      cardId={props.title}
    >
      {props.child && children(props.child)}
    </CardShell>
  ),

  StatusBadge: ({ props }) => {
    const variant = props.variant ?? "info";
    const Icon = {
      error: TriangleAlert,
      warning: CircleAlert,
      success: CircleCheck,
      info: Info,
    }[variant];
    return (
      // `alignSelf: flex-start` keeps the pill content-sized — flex parents
      // (our Column override) default to stretch, which inflates it into a
      // full-width banner.
      <Badge
        variant={variant}
        style={{ alignSelf: "flex-start" }}
        data-testid="declarative-status-badge"
      >
        <Icon size={12} strokeWidth={2.5} style={{ marginRight: 4 }} />
        {props.text}
      </Badge>
    );
  },

  Metric: ({ props }) => {
    const trendColors: Record<string, string> = {
      up: "#059669",
      down: "#dc2626",
      neutral: c.muted,
    };
    const trendIcons: Record<string, string> = {
      up: "↑",
      down: "↓",
      neutral: "→",
    };
    return (
      <div
        data-testid="declarative-metric"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          minWidth: "120px",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: c.muted,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {props.label}
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
          <span
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: c.cardFg,
              letterSpacing: "-0.02em",
            }}
          >
            {props.value}
          </span>
          {props.trend && (
            <span
              style={{
                fontSize: "0.8rem",
                fontWeight: 500,
                color: trendColors[props.trend] ?? c.muted,
              }}
            >
              {trendIcons[props.trend]}
              {props.trendValue ? ` ${props.trendValue}` : ""}
            </span>
          )}
        </div>
      </div>
    );
  },

  InfoRow: ({ props }) => (
    // Divider via `border-b last:border-b-0` so the final row doesn't dangle
    // a trailing line, regardless of whether the agent wraps these in a
    // Column or drops them directly into a Card's child slot.
    <div
      data-testid="declarative-info-row"
      className="flex items-baseline justify-between gap-4 py-2 border-b border-[var(--border)] last:border-b-0 last:pb-0 first:pt-0"
    >
      <span className="text-sm text-[var(--muted-foreground)]">
        {props.label}
      </span>
      <span className="text-sm font-medium text-[var(--foreground)] text-right tabular-nums">
        {props.value}
      </span>
    </div>
  ),

  DataTable: ({ props }) => {
    const cols = Array.isArray(props.columns) ? props.columns : [];
    const rows = Array.isArray(props.rows) ? props.rows : [];
    return (
      <div
        data-testid="declarative-data-table"
        className="w-full overflow-x-auto"
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {cols.map((col) => (
                <th
                  key={col.key}
                  className="border-b-2 border-[var(--border)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              // Stable row key: prefer the first column's value (primary-key-ish),
              // suffix with index in case values repeat, fall back to a JSON
              // stringify of the row when columns is empty. Stable keys prevent
              // React from re-mounting every row when the agent re-emits a
              // slightly different table.
              const pk = cols.length > 0 ? row[cols[0].key] : undefined;
              const rowKey =
                pk !== undefined ? `${pk}-${i}` : JSON.stringify(row);
              return (
                <tr
                  key={rowKey}
                  className="border-b border-[var(--border)] last:border-b-0"
                >
                  {cols.map((col) => (
                    <td
                      key={col.key}
                      className="px-3 py-2 tabular-nums text-[var(--foreground)]"
                    >
                      {String(row[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  },

  PrimaryButton: ({ props, dispatch }) => (
    <Button
      onClick={() => {
        if (props.action && dispatch) dispatch(props.action);
      }}
    >
      {props.label}
    </Button>
  ),

  PieChart: ({ props }) => {
    // Coerce values to numbers — the LLM sometimes emits them as strings.
    // Use a strict finite check so null/undefined/NaN/non-numeric strings are
    // surfaced via console.warn rather than silently collapsed to 0 (which
    // masks schema/data drift). Recharts requires a numeric value to render,
    // so we fall back to 0 only after logging.
    const data = (Array.isArray(props.data) ? props.data : []).map((d) => {
      const raw = (d as { value?: unknown }).value;
      const n = typeof raw === "number" ? raw : parseFloat(raw as string);
      let value: number;
      if (Number.isFinite(n)) {
        value = n;
      } else {
        console.warn("Invalid chart value", {
          component: "PieChart",
          key: "value",
          raw,
        });
        value = 0;
      }
      return { ...d, value };
    });
    return (
      <CardShell
        title={props.title}
        subtitle={props.description}
        testid="declarative-pie-chart"
      >
        {data.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
            No data available
          </div>
        ) : (
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <RechartsPieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardShell>
    );
  },

  BarChart: ({ props }) => {
    // Coerce values to numbers — the LLM sometimes emits them as strings,
    // which recharts treats as categorical (unordered Y-axis ticks). Use a
    // strict finite check so null/undefined/NaN/non-numeric strings are
    // surfaced via console.warn rather than silently collapsed to 0 (which
    // masks schema/data drift). Recharts requires a numeric value to render,
    // so we fall back to 0 only after logging.
    const data = (Array.isArray(props.data) ? props.data : []).map((d) => {
      const raw = (d as { value?: unknown }).value;
      const n = typeof raw === "number" ? raw : parseFloat(raw as string);
      let value: number;
      if (Number.isFinite(n)) {
        value = n;
      } else {
        console.warn("Invalid chart value", {
          component: "BarChart",
          key: "value",
          raw,
        });
        value = 0;
      }
      return { ...d, value };
    });
    return (
      <CardShell
        title={props.title}
        subtitle={props.description}
        testid="declarative-bar-chart"
      >
        {data.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
            No data available
          </div>
        ) : (
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <RechartsBarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.divider} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.muted }} />
                <YAxis tick={{ fontSize: 11, fill: c.muted }} />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardShell>
    );
  },
};
// @endregion[renderers-react]
