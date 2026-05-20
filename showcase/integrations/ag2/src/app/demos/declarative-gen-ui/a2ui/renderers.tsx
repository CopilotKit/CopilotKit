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
import React, { useRef } from "react";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Rectangle,
} from "recharts";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { MyDefinitions } from "./definitions";

// ─── Brand chart palette (verbatim from beautiful-chat/charts/config.ts) ────
// CopilotKit brand tokens — Plus Jakarta Sans / brand colour system.
const CHART_COLORS = [
  "#BEC2FF", // lilac-400
  "#85ECCE", // mint-400
  "#FFAC4D", // orange-400
  "#FFF388", // yellow-400
  "#189370", // mint-800
  "#EEE6FE", // primary-100
  "#FA5F67", // red-400
] as const;

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "white",
  border: "1px solid #DBDBE5",
  borderRadius: 10,
  padding: "10px 14px",
  color: "#010507",
  fontSize: 13,
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

/** Custom SVG donut chart built with <circle> + stroke-dasharray. */
function DonutChart({
  data,
  size = 240,
  strokeWidth = 40,
}: {
  data: { label: string; value: number }[];
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  let accumulated = 0;
  const slices = data.map((item, index) => {
    const val = Number(item.value) || 0;
    const ratio = total > 0 ? val / total : 0;
    const arc = ratio * circumference;
    const startAt = accumulated;
    accumulated += arc;
    return {
      ...item,
      arc,
      gap: circumference - arc,
      dashoffset: -startAt,
      color: CHART_COLORS[index % CHART_COLORS.length],
    };
  });

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${size} ${size}`}
      style={{
        display: "block",
        margin: "0 auto",
        maxWidth: size,
        transform: "scaleX(-1)",
      }}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="#F4F4F7"
        strokeWidth={strokeWidth}
      />
      {slices.map((slice, i) => (
        <circle
          key={i}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={slice.color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${slice.arc} ${slice.gap}`}
          strokeDashoffset={slice.dashoffset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${center} ${center})`}
        />
      ))}
    </svg>
  );
}

/** Tracks seen indices so only NEW bars get the fade-in animation. */
function useSeenIndices() {
  const seen = useRef(new Set<number>());
  return {
    isNew(index: number) {
      if (seen.current.has(index)) return false;
      seen.current.add(index);
      return true;
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AnimatedBar(props: any) {
  const { isNew, ...rest } = props;
  return (
    <g
      style={
        isNew
          ? {
              animation: "barSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
            }
          : undefined
      }
    >
      <Rectangle {...rest} />
    </g>
  );
}

const badgePalette: Record<
  "success" | "warning" | "error" | "info",
  { bg: string; fg: string; border: string }
> = {
  success: {
    bg: "rgba(133, 236, 206, 0.15)",
    fg: "#189370",
    border: "#85ECCE4D",
  },
  warning: {
    bg: "rgba(255, 172, 77, 0.12)",
    fg: "#010507",
    border: "#FFAC4D33",
  },
  error: { bg: "rgba(250, 95, 103, 0.1)", fg: "#FA5F67", border: "#FA5F6733" },
  info: { bg: "#BEC2FF1A", fg: "#010507", border: "#BEC2FF" },
};

// @region[renderers-react]
export const myRenderers: CatalogRenderers<MyDefinitions> = {
  Card: ({ props, children }) => (
    <div
      style={{
        border: "1px solid #DBDBE5",
        borderRadius: 16,
        padding: 20,
        background: "white",
        boxShadow: "0 1px 3px rgba(1, 5, 7, 0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 260,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontWeight: 600, fontSize: "1rem", color: "#010507" }}>
          {props.title}
        </div>
        {props.subtitle && (
          <div style={{ color: "#57575B", fontSize: "0.85rem" }}>
            {props.subtitle}
          </div>
        )}
      </div>
      {props.child && children(props.child)}
    </div>
  ),

  StatusBadge: ({ props }) => {
    const variant = props.variant ?? "info";
    const { bg, fg, border } = badgePalette[variant];
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 10px",
          background: bg,
          color: fg,
          border: `1px solid ${border}`,
          borderRadius: 999,
          fontSize: "0.7rem",
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
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
      trend === "up" ? "#189370" : trend === "down" ? "#FA5F67" : "#010507";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontSize: "0.7rem",
            color: "#838389",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          {props.label}
        </div>
        <div
          style={{
            fontSize: "1.5rem",
            fontWeight: 600,
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
        borderBottom: "1px solid #E9E9EF",
      }}
    >
      <span style={{ color: "#57575B", fontSize: "0.85rem" }}>
        {props.label}
      </span>
      <span style={{ color: "#010507", fontWeight: 500, fontSize: "0.9rem" }}>
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
        borderRadius: 12,
        border: "none",
        background: "#010507",
        color: "white",
        fontWeight: 500,
        fontSize: "0.9rem",
        cursor: "pointer",
        transition: "background 0.15s ease",
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background = "#2B2B2B")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background = "#010507")
      }
    >
      {props.label}
    </button>
  ),

  PieChart: ({ props }) => {
    const data = props.data ?? [];
    const safeData = Array.isArray(data) ? data : [];
    const total = safeData.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    return (
      <div
        style={{
          border: "1px solid #DBDBE5",
          borderRadius: 16,
          padding: 20,
          background: "white",
          boxShadow: "0 1px 3px rgba(1, 5, 7, 0.04)",
          maxWidth: 520,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontWeight: 600, fontSize: "1rem", color: "#010507" }}>
            {props.title}
          </div>
          <div style={{ color: "#57575B", fontSize: "0.85rem" }}>
            {props.description}
          </div>
        </div>

        {safeData.length === 0 ? (
          <div
            style={{
              color: "#838389",
              textAlign: "center",
              padding: "32px 0",
              fontSize: "0.85rem",
            }}
          >
            No data available
          </div>
        ) : (
          <>
            <DonutChart data={safeData} />

            {/* Legend */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingTop: 8,
              }}
            >
              {safeData.map((item, index) => {
                const val = Number(item.value) || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(0) : "0";
                return (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      fontSize: "0.85rem",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        borderRadius: 999,
                        flexShrink: 0,
                        backgroundColor:
                          CHART_COLORS[index % CHART_COLORS.length],
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        color: "#010507",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.label}
                    </span>
                    <span
                      style={{
                        color: "#57575B",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {val.toLocaleString()}
                    </span>
                    <span
                      style={{
                        color: "#57575B",
                        width: 40,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  },

  BarChart: ({ props }) => {
    const { isNew } = useSeenIndices();
    const data = props.data ?? [];
    const safeData = Array.isArray(data) ? data : [];

    return (
      <div
        style={{
          border: "1px solid #DBDBE5",
          borderRadius: 16,
          padding: 20,
          background: "white",
          boxShadow: "0 1px 3px rgba(1, 5, 7, 0.04)",
          maxWidth: 640,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
        }}
      >
        {/* Scoped keyframe — no globals.css needed */}
        <style>{`
          @keyframes barSlideIn {
            from { transform: translateY(40px); opacity: 0; }
            20% { opacity: 1; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontWeight: 600, fontSize: "1rem", color: "#010507" }}>
            {props.title}
          </div>
          <div style={{ color: "#57575B", fontSize: "0.85rem" }}>
            {props.description}
          </div>
        </div>

        {safeData.length === 0 ? (
          <div
            style={{
              color: "#838389",
              textAlign: "center",
              padding: "32px 0",
              fontSize: "0.85rem",
            }}
          >
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <RechartsBarChart
              data={safeData}
              margin={{ top: 12, right: 12, bottom: 4, left: -8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#E9E9EF"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "#57575B" }}
                stroke="#E9E9EF"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#57575B" }}
                stroke="#E9E9EF"
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                cursor={{ fill: "#F4F4F7", opacity: 0.5 }}
              />
              <Bar
                isAnimationActive={false}
                dataKey="value"
                radius={[6, 6, 0, 0]}
                maxBarSize={48}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                shape={
                  ((barProps: any) => (
                    <AnimatedBar
                      {...barProps}
                      isNew={isNew(barProps.index as number)}
                    />
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  )) as any
                }
              >
                {safeData.map((_, index) => (
                  <Cell
                    key={index}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                  />
                ))}
              </Bar>
            </RechartsBarChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  },
};
// @endregion[renderers-react]
