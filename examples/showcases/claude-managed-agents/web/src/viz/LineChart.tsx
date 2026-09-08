/**
 * Shared SVG line chart: recessive grid, 2px series lines, direct end labels,
 * and a crosshair + tooltip hover layer (nearest x across all series).
 */
import React, { useRef, useState } from "react";
import { INK } from "./theme";

export interface Series {
  label: string;
  color: string;
  /** y value per x step; all series share the x domain [0, maxX]. */
  values: number[];
  /** Fill the area under this series (used for the primary series only). */
  area?: boolean;
}

interface Props {
  series: Series[];
  /** Format an x step for ticks and tooltips (e.g. month → "Yr 2"). */
  fmtX: (x: number) => string;
  /** Format a y value (e.g. dollars). */
  fmtY: (y: number) => string;
  height?: number;
}

const W = 640;
const PAD = { top: 14, right: 96, bottom: 26, left: 52 };

export const LineChart: React.FC<Props> = ({
  series,
  fmtX,
  fmtY,
  height = 220,
}) => {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const maxX = Math.max(1, ...series.map((s) => s.values.length - 1));
  const maxY = Math.max(1, ...series.flatMap((s) => s.values));
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const xPos = (x: number) => PAD.left + (x / maxX) * plotW;
  const yPos = (y: number) => PAD.top + plotH - (y / maxY) * plotH;

  // Rebuilt per render; ≤600 points of string concat is well under a frame.
  const paths = series.map((s) => {
    const pts = s.values.map(
      (v, i) => `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`,
    );
    const line = `M${pts.join("L")}`;
    const area = `${line}L${xPos(s.values.length - 1).toFixed(1)},${yPos(0)}L${xPos(0)},${yPos(0)}Z`;
    return { line, area };
  });

  const yTicks = [0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  const xTickCount = Math.min(6, maxX);
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) =>
    Math.round((i / xTickCount) * maxX),
  );

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = ((e.clientX - rect.left) / rect.width) * W;
    const x = Math.round(((frac - PAD.left) / plotW) * maxX);
    setHoverX(x >= 0 && x <= maxX ? x : null);
  };

  // Direct end labels, nudged apart when two series end close together.
  // Keyed by series index — labels can collide (e.g. two payments that format
  // to the same dollar string).
  const endLabels = series
    .map((s, i) => ({
      key: i,
      label: s.label,
      color: s.color,
      y: yPos(s.values[s.values.length - 1] ?? 0),
    }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i]!.y - endLabels[i - 1]!.y < 14)
      endLabels[i]!.y = endLabels[i - 1]!.y + 14;
  }

  return (
    <div className="viz-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: "100%", display: "block" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverX(null)}
        role="img"
        aria-label={series.map((s) => s.label).join(" vs ")}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yPos(t)}
              y2={yPos(t)}
              stroke={INK.grid}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={yPos(t) + 3.5}
              textAnchor="end"
              fontSize={10}
              fill={INK.secondary}
            >
              {fmtY(t)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={yPos(0)}
          y2={yPos(0)}
          stroke={INK.secondary}
          strokeWidth={1}
        />
        {xTicks.map((t) => (
          <text
            key={t}
            x={xPos(t)}
            y={height - 8}
            textAnchor="middle"
            fontSize={10}
            fill={INK.secondary}
          >
            {fmtX(t)}
          </text>
        ))}

        {series.map((s, i) =>
          s.area ? (
            <path
              key={`a${i}`}
              d={paths[i]!.area}
              fill={s.color}
              opacity={0.12}
            />
          ) : null,
        )}
        {series.map((s, i) => (
          <path
            key={`l${i}`}
            d={paths[i]!.line}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}

        {endLabels.map((l) => (
          <text
            key={l.key}
            x={W - PAD.right + 8}
            y={l.y + 3.5}
            fontSize={11}
            fontWeight={600}
            fill={l.color}
          >
            {l.label}
          </text>
        ))}

        {hoverX != null && (
          <g pointerEvents="none">
            <line
              x1={xPos(hoverX)}
              x2={xPos(hoverX)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={INK.secondary}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {series.map(
              (s, i) =>
                s.values[hoverX] != null && (
                  <circle
                    key={i}
                    cx={xPos(hoverX)}
                    cy={yPos(s.values[hoverX]!)}
                    r={4}
                    fill={s.color}
                    stroke={INK.surface}
                    strokeWidth={2}
                  />
                ),
            )}
          </g>
        )}
      </svg>
      {hoverX != null && (
        <div className="viz-tooltip">
          <span className="viz-tooltip-x">{fmtX(hoverX)}</span>
          {series.map(
            (s, i) =>
              s.values[hoverX] != null && (
                <span key={i}>
                  <i style={{ background: s.color }} /> {s.label}:{" "}
                  <b>{fmtY(s.values[hoverX]!)}</b>
                </span>
              ),
          )}
        </div>
      )}
    </div>
  );
};
