import React from "react";
import { z } from "zod";

/**
 * Experimental-design PieChart — the same shape as the canonical
 * `gen-ui-tool-based/pie-chart.tsx` (so the agent's tool schema is
 * identical), but restyled with the lavender-glass palette: purple
 * accent + sister hues, hard 4px corners, Plus Jakarta Sans typography,
 * monospace number labels, single accent eyebrow line.
 */

export const pieChartPropsSchema = z.object({
  title: z.string().describe("Chart title"),
  description: z.string().describe("Brief description or subtitle"),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
});

export type PieChartProps = z.infer<typeof pieChartPropsSchema>;

// Diagrammatic palette from the experimental skill. Pulled from CSS
// custom properties at runtime so a single theme change retints all
// charts; static fallbacks below match `_experimental-theme/theme.css`.
const PALETTE = [
  "var(--xd-palette-0, #6E6BFF)",
  "var(--xd-palette-1, #A78BFA)",
  "var(--xd-palette-2, #87EAD1)",
  "var(--xd-palette-3, #F4A3FF)",
  "var(--xd-palette-4, #FFC785)",
  "var(--xd-palette-5, #83FF6E)",
];

export function PieChart({ title, description, data }: PieChartProps) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="hd-exp-card" style={{ maxWidth: 480, margin: "16px auto" }}>
        <div className="hd-exp-card-title">{title}</div>
        <div style={{ fontFamily: "var(--xd-sans)", fontSize: 13, color: "var(--xd-fg-muted)", marginTop: -8 }}>
          {description}
        </div>
        <p
          style={{
            fontFamily: "var(--xd-sans)",
            fontSize: 13,
            color: "var(--xd-fg-subtle)",
            textAlign: "center",
            padding: "32px 0",
          }}
        >
          No data available
        </p>
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  const size = 220;
  const strokeWidth = 38;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let accumulated = 0;
  const slices = data.map((item, index) => {
    const val = Number(item.value) || 0;
    const ratio = total > 0 ? val / total : 0;
    const arc = ratio * circumference;
    const startAt = accumulated;
    accumulated += arc;
    return {
      arc,
      gap: circumference - arc,
      dashoffset: -startAt,
      color: PALETTE[index % PALETTE.length],
    };
  });

  return (
    <div className="hd-exp-card" style={{ maxWidth: 520, margin: "16px auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="hd-exp-card-title" style={{ margin: 0 }}>
          {title}
        </div>
        <span className="hd-exp-eyebrow">Emitted by agent</span>
      </div>
      {description ? (
        <div
          style={{
            fontFamily: "var(--xd-sans)",
            fontSize: 13,
            color: "var(--xd-fg-muted)",
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ flexShrink: 0, transform: "scaleX(-1)" }}
          aria-hidden
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(17, 9, 30, 0.06)"
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

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {data.map((item, index) => {
            const val = Number(item.value) || 0;
            const pct = total > 0 ? ((val / total) * 100).toFixed(0) : 0;
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "var(--xd-sans)",
                  fontSize: 12.5,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 9,
                    height: 9,
                    borderRadius: 2,
                    backgroundColor: PALETTE[index % PALETTE.length],
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, color: "var(--xd-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--xd-mono)",
                    fontSize: 11.5,
                    color: "var(--xd-fg-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {val.toLocaleString()}
                </span>
                <span
                  style={{
                    fontFamily: "var(--xd-mono)",
                    fontSize: 11,
                    color: "var(--xd-fg-muted)",
                    fontVariantNumeric: "tabular-nums",
                    width: 32,
                    textAlign: "right",
                  }}
                >
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
