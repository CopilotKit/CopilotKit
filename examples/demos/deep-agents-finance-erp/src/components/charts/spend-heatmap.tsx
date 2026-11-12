"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { monthlyExpenseByCategory } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import type { SpendHeatmapWidget } from "@/types/dashboard";

type CategoryKey =
  | "payroll"
  | "operations"
  | "marketing"
  | "infrastructure"
  | "rnd"
  | "other";

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  payroll: "Payroll",
  operations: "Operations",
  marketing: "Marketing",
  infrastructure: "Infra",
  rnd: "R&D",
  other: "Other",
};

const COLOR_SCALES: Record<string, { bg: string; hue: string }> = {
  purple: { bg: "rgb(139, 92, 246)", hue: "violet" },
  blue: { bg: "rgb(59, 130, 246)", hue: "blue" },
  red: { bg: "rgb(239, 68, 68)", hue: "red" },
};

export function SpendHeatmap({
  config,
}: {
  config: SpendHeatmapWidget["config"];
}) {
  const title = config.title ?? "Expense Heatmap";
  const subtitle = config.subtitle ?? "Monthly spend intensity by category";
  const scale =
    COLOR_SCALES[config.colorScale ?? "purple"] ?? COLOR_SCALES.purple;

  const categories: CategoryKey[] = config.categories ?? [
    "payroll",
    "operations",
    "marketing",
    "infrastructure",
    "rnd",
    "other",
  ];
  const months = monthlyExpenseByCategory.map((d) => d.month);

  // Build matrix: row = category, col = month
  const matrix: { category: CategoryKey; values: number[] }[] = categories.map(
    (cat) => ({
      category: cat,
      values: monthlyExpenseByCategory.map((d) => d[cat]),
    }),
  );

  // Find global min/max for normalization
  const allValues = matrix.flatMap((r) => r.values);
  const globalMin = Math.min(...allValues);
  const globalMax = Math.max(...allValues);

  // Find peak
  let peakMonth = "";
  let peakCategory = "";
  let peakValue = 0;
  matrix.forEach((row) => {
    row.values.forEach((v, mi) => {
      if (v > peakValue) {
        peakValue = v;
        peakMonth = months[mi];
        peakCategory = CATEGORY_LABELS[row.category];
      }
    });
  });

  // Row totals
  const rowTotals = matrix.map((row) => row.values.reduce((s, v) => s + v, 0));
  // Column totals
  const colTotals = months.map((_, mi) =>
    matrix.reduce((s, row) => s + row.values[mi], 0),
  );

  const [hoveredCell, setHoveredCell] = useState<{
    row: number;
    col: number;
  } | null>(null);

  function normalize(value: number): number {
    if (globalMax === globalMin) return 0.5;
    return 0.12 + ((value - globalMin) / (globalMax - globalMin)) * 0.88;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold text-violet-700">
              Peak: {peakCategory} in {peakMonth}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div
            className="grid gap-[3px] text-[10px]"
            style={{
              gridTemplateColumns: `80px repeat(${months.length}, 1fr) 56px`,
            }}
          >
            {/* Header row: empty + months + "Total" */}
            <div />
            {months.map((m) => (
              <div
                key={m}
                className="text-center font-medium text-muted-foreground py-1"
              >
                {m}
              </div>
            ))}
            <div className="text-center font-medium text-muted-foreground py-1">
              Total
            </div>

            {/* Data rows */}
            {matrix.map((row, ri) => (
              <div key={row.category} className="contents">
                {/* Category label */}
                <div className="flex items-center text-xs font-medium text-foreground pr-2">
                  {CATEGORY_LABELS[row.category]}
                </div>
                {/* Cells */}
                {row.values.map((val, ci) => {
                  const intensity = normalize(val);
                  const isHovered =
                    hoveredCell?.row === ri && hoveredCell?.col === ci;
                  return (
                    <div
                      key={ci}
                      className="relative flex items-center justify-center rounded-[4px] cursor-default transition-transform"
                      style={{
                        backgroundColor: scale.bg,
                        opacity: intensity,
                        height: 28,
                        transform: isHovered ? "scale(1.12)" : "scale(1)",
                        zIndex: isHovered ? 10 : 1,
                      }}
                      onMouseEnter={() => setHoveredCell({ row: ri, col: ci })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {isHovered && (
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-[10px] font-medium text-background shadow-lg z-20">
                          {formatCurrency(val)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Row total */}
                <div className="flex items-center justify-end text-[10px] font-medium text-muted-foreground pl-1">
                  {formatCurrency(rowTotals[ri])}
                </div>
              </div>
            ))}

            {/* Footer: column totals */}
            <div className="flex items-center text-[10px] font-medium text-muted-foreground pt-1">
              Monthly
            </div>
            {colTotals.map((total, ci) => (
              <div
                key={ci}
                className="text-center text-[10px] font-medium text-muted-foreground pt-1"
              >
                {total >= 1000 ? `${(total / 1000).toFixed(0)}K` : total}
              </div>
            ))}
            <div />
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Low</span>
          <div className="flex gap-[2px]">
            {[0.15, 0.3, 0.5, 0.7, 0.85, 1.0].map((o) => (
              <div
                key={o}
                className="h-2.5 w-5 rounded-[2px]"
                style={{ backgroundColor: scale.bg, opacity: o }}
              />
            ))}
          </div>
          <span>High</span>
        </div>
      </CardContent>
    </Card>
  );
}
