/**
 * A2UI Catalog — React Renderers
 *
 * Each component maps a name from definitions.ts to a React implementation.
 * `createGenerativeUI` types its props from the Zod schema.
 *
 * To add a component: define its schema in definitions.ts, then add a
 * renderer here. See README.md "Adding a custom component" for details.
 *
 * The assembled catalog is registered in page.tsx via
 * <CopilotKitProvider generativeUI={{ ui: demonstrationCatalog }}>.
 */
"use client";

import React, { useState } from "react";
import type { JSX } from "react";
import {
  PieChart as RechartsPie,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart as RechartsBar,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { demonstrationCatalogDefinitions } from "./definitions";
import type { DemonstrationCatalogDefinitions } from "./definitions";
import type { z } from "zod";
import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/generative-ui";

// ─── Theme-aware colors ─────────────────────────────────────────────

const c = {
  card: "var(--card)",
  cardFg: "var(--card-foreground)",
  border: "var(--border)",
  muted: "var(--muted-foreground)",
  divider: "color-mix(in srgb, var(--border) 50%, var(--card))",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  btnBg: "color-mix(in srgb, var(--muted) 40%, var(--card))",
  btnDoneBg: "color-mix(in srgb, #22c55e 10%, var(--card))",
};

// Recharts' default tooltip is white with a #ccc border; follow the theme.
const tooltipStyle = {
  backgroundColor: c.card,
  border: "1px solid light-dark(#ccc, var(--border))",
};

function ActionButton({
  label,
  doneLabel,
  action,
  children: child,
}: {
  label: string;
  doneLabel: string;
  action: any;
  children?: React.ReactNode;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      disabled={done}
      style={{
        width: "100%",
        padding: "10px 16px",
        borderRadius: "10px",
        border: done
          ? "1px solid light-dark(#bbf7d0, #166534)"
          : `1px solid ${c.border}`,
        background: done ? c.btnDoneBg : c.btnBg,
        color: done ? "light-dark(#059669, #34d399)" : c.cardFg,
        fontSize: "0.85rem",
        fontWeight: 500,
        cursor: done ? "default" : "pointer",
        transition: "all 0.2s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
      }}
      onClick={() => {
        if (!done) {
          action?.();
          setDone(true);
        }
      }}
    >
      {done && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {done ? doneLabel : (child ?? label)}
    </button>
  );
}

/**
 * The props a component gets: the output of its schema. Generative UI
 * resolves path bindings before render, and hands `child` / `children`
 * over as rendered nodes.
 */
type PropsOf<Name extends keyof DemonstrationCatalogDefinitions> = z.output<
  DemonstrationCatalogDefinitions[Name]["props"]
>;

// ─── Assembled Catalog ───────────────────────────────────────────────

export const demonstrationCatalog = createGenerativeUI({
  id: "copilotkit://app-dashboard-catalog",
  extends: [standardUI.omit(["Title", "Row", "Column", "Badge", "Button"])],
  components: {
    Title: {
      component: (props: PropsOf<"Title">) => {
        const Tag = (
          props.level === "h1" ? "h1" : props.level === "h3" ? "h3" : "h2"
        ) as keyof JSX.IntrinsicElements;
        const sizes: Record<string, string> = {
          h1: "1.75rem",
          h2: "1.25rem",
          h3: "1rem",
        };
        return (
          <Tag
            style={{
              margin: 0,
              fontWeight: 600,
              fontSize: sizes[props.level ?? "h2"],
              color: c.cardFg,
              letterSpacing: "-0.01em",
            }}
          >
            {props.text}
          </Tag>
        );
      },
      ...demonstrationCatalogDefinitions.Title,
    },
    Row: {
      component: (props: PropsOf<"Row">) => {
        const justifyMap: Record<string, string> = {
          start: "flex-start",
          center: "center",
          end: "flex-end",
          spaceBetween: "space-between",
        };
        return (
          // Each child takes an equal share of the row. The children are
          // the rendered components (a template renders them as siblings
          // too), so a child selector sizes them.
          <div
            className="[&>*]:min-w-0 [&>*]:flex-[1_1_0]"
            style={{
              display: "flex",
              flexDirection: "row",
              gap: `${props.gap ?? 16}px`,
              alignItems: props.align ?? "stretch",
              justifyContent:
                justifyMap[props.justify ?? "start"] ?? "flex-start",
              flexWrap: "wrap",
              width: "100%",
            }}
          >
            {props.children}
          </div>
        );
      },
      ...demonstrationCatalogDefinitions.Row,
    },
    Column: {
      component: (props: PropsOf<"Column">) => {
        return (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: `${props.gap ?? 12}px`,
              width: "100%",
            }}
          >
            {props.children}
          </div>
        );
      },
      ...demonstrationCatalogDefinitions.Column,
    },
    DashboardCard: {
      component: (props: PropsOf<"DashboardCard">) => (
        <div
          style={{
            background: c.card,
            borderRadius: "12px",
            border: `1px solid ${c.border}`,
            padding: "20px",
            boxShadow: c.shadow,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div>
            <div
              style={{ fontWeight: 600, fontSize: "0.9rem", color: c.cardFg }}
            >
              {props.title}
            </div>
            {props.subtitle && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: c.muted,
                  marginTop: "2px",
                }}
              >
                {props.subtitle}
              </div>
            )}
          </div>
          {props.child}
        </div>
      ),
      ...demonstrationCatalogDefinitions.DashboardCard,
    },
    Metric: {
      component: (props: PropsOf<"Metric">) => {
        const trendColors: Record<string, string> = {
          up: "light-dark(#059669, #34d399)",
          down: "light-dark(#dc2626, #f87171)",
          neutral: c.muted,
        };
        const trendIcons: Record<string, string> = {
          up: "↑",
          down: "↓",
          neutral: "→",
        };
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
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
            <div
              style={{ display: "flex", alignItems: "baseline", gap: "8px" }}
            >
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
              {props.trend && props.trendValue && (
                <span
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    color: trendColors[props.trend] ?? c.muted,
                  }}
                >
                  {trendIcons[props.trend]} {props.trendValue}
                </span>
              )}
            </div>
          </div>
        );
      },
      ...demonstrationCatalogDefinitions.Metric,
    },
    PieChart: {
      component: (props: PropsOf<"PieChart">) => {
        const COLORS = [
          "#3b82f6",
          "#8b5cf6",
          "#ec4899",
          "#f59e0b",
          "#10b981",
          "#6366f1",
        ];
        const data = props.data ?? [];
        return (
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <RechartsPie>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={props.innerRadius ?? 40}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.map((entry: any, i: number) => (
                    <Cell
                      key={i}
                      fill={entry.color ?? COLORS[i % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </RechartsPie>
            </ResponsiveContainer>
          </div>
        );
      },
      ...demonstrationCatalogDefinitions.PieChart,
    },
    BarChart: {
      component: (props: PropsOf<"BarChart">) => {
        const data = props.data ?? [];
        return (
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <RechartsBar data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.divider} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.muted }} />
                <YAxis tick={{ fontSize: 11, fill: c.muted }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "light-dark(#ccc, var(--muted))" }}
                />
                <Bar
                  dataKey="value"
                  fill={props.color ?? "#3b82f6"}
                  radius={[4, 4, 0, 0]}
                />
              </RechartsBar>
            </ResponsiveContainer>
          </div>
        );
      },
      ...demonstrationCatalogDefinitions.BarChart,
    },
    Badge: {
      component: (props: PropsOf<"Badge">) => {
        const variants: Record<string, { bg: string; color: string }> = {
          success: {
            bg: "light-dark(#dcfce7, color-mix(in srgb, #22c55e 15%, transparent))",
            color: "light-dark(#166534, #86efac)",
          },
          warning: {
            bg: "light-dark(#fef3c7, color-mix(in srgb, #f59e0b 15%, transparent))",
            color: "light-dark(#92400e, #fcd34d)",
          },
          error: {
            bg: "light-dark(#fee2e2, color-mix(in srgb, #ef4444 15%, transparent))",
            color: "light-dark(#991b1b, #fca5a5)",
          },
          info: {
            bg: "light-dark(#dbeafe, color-mix(in srgb, #3b82f6 15%, transparent))",
            color: "light-dark(#1e40af, #93c5fd)",
          },
          neutral: { bg: "var(--muted)", color: c.cardFg },
        };
        const v = variants[props.variant ?? "neutral"] ?? variants.neutral;
        return (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: "9999px",
              fontSize: "0.7rem",
              fontWeight: 500,
              background: v.bg,
              color: v.color,
            }}
          >
            {props.text}
          </span>
        );
      },
      ...demonstrationCatalogDefinitions.Badge,
    },
    DataTable: {
      component: (props: PropsOf<"DataTable">) => {
        const cols = props.columns ?? [];
        const rows = props.rows ?? [];
        return (
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.8rem",
              }}
            >
              <thead>
                <tr>
                  {cols.map((col: any) => (
                    <th
                      key={col.key}
                      style={{
                        textAlign: "left",
                        padding: "8px 12px",
                        borderBottom: `2px solid ${c.border}`,
                        color: c.muted,
                        fontWeight: 600,
                        fontSize: "0.7rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any, i: number) => (
                  <tr
                    key={i}
                    style={{ borderBottom: `1px solid ${c.divider}` }}
                  >
                    {cols.map((col: any) => (
                      <td
                        key={col.key}
                        style={{ padding: "8px 12px", color: c.cardFg }}
                      >
                        {String(row[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      },
      ...demonstrationCatalogDefinitions.DataTable,
    },
    Button: {
      component: (props: PropsOf<"Button"> & { onClick?: () => void }) => {
        return (
          <ActionButton label="Click" doneLabel="Done" action={props.onClick}>
            {props.child}
          </ActionButton>
        );
      },
      ...demonstrationCatalogDefinitions.Button,
    },
    FlightCard: {
      component: (props: PropsOf<"FlightCard"> & { action?: () => void }) => {
        const statusColors: Record<string, string> = {
          "On Time": "#22c55e",
          Delayed: "#eab308",
          Cancelled: "#ef4444",
        };
        const dotColor =
          props.statusColor ?? statusColors[props.status] ?? "#22c55e";

        return (
          <div
            style={{
              border: `1px solid ${c.border}`,
              borderRadius: "16px",
              padding: "20px",
              background: c.card,
              color: c.cardFg,
              minWidth: 260,
              maxWidth: 340,
              flex: "1 1 260px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              boxShadow: c.shadow,
            }}
          >
            {/* Header: airline + price */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <img
                  src={props.airlineLogo}
                  alt={props.airline}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    objectFit: "contain",
                  }}
                />
                <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                  {props.airline}
                </span>
              </div>
              <span style={{ fontWeight: 700, fontSize: "1.15rem" }}>
                {props.price}
              </span>
            </div>

            {/* Meta */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.8rem",
                color: c.muted,
              }}
            >
              <span>{props.flightNumber}</span>
              <span>{props.date}</span>
            </div>

            <hr
              style={{
                border: "none",
                borderTop: `1px solid ${c.divider}`,
                margin: 0,
              }}
            />

            {/* Times */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                {props.departureTime}
              </span>
              <span style={{ fontSize: "0.75rem", color: c.muted }}>
                {props.duration}
              </span>
              <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                {props.arrivalTime}
              </span>
            </div>

            {/* Route */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.95rem",
                fontWeight: 600,
              }}
            >
              <span>{props.origin}</span>
              <span style={{ color: c.muted }}>→</span>
              <span>{props.destination}</span>
            </div>

            <div
              style={{
                marginTop: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <hr
                style={{
                  border: "none",
                  borderTop: `1px solid ${c.divider}`,
                  margin: 0,
                }}
              />

              {/* Status */}
              <div
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dotColor,
                    display: "inline-block",
                  }}
                />
                <span style={{ fontSize: "0.8rem", color: c.muted }}>
                  {props.status}
                </span>
              </div>

              <ActionButton
                label="Select"
                doneLabel="Selected"
                action={props.action}
              />
            </div>
          </div>
        );
      },
      ...demonstrationCatalogDefinitions.FlightCard,
    },
  },
});
