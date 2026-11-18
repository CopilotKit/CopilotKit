"use client";
import { AreaChart, DonutChart } from "@/components/charts";
import {
  computeKpis,
  revenueByCategory,
  salesOverTime,
  formatCurrency,
  CATEGORY_STYLES,
} from "@/lib/crm";
import type { CrmState, ProductCategory } from "@/lib/crm";
import { SectionCard } from "./primitives";

/** Map a product category to one of the chart palette tokens (blue-led). */
const CATEGORY_COLOR: Record<ProductCategory, string> = {
  Laptop: "var(--chart-1)",
  Workstation: "var(--chart-3)",
  Server: "var(--chart-4)",
  Display: "var(--chart-2)",
  Accessory: "var(--chart-5)",
};

/** Section 2 — monthly bookings as a smooth area chart (last 8 months). */
export function SalesOverTimeCard({ crm }: { crm: CrmState }) {
  const data = salesOverTime(crm).map((p) => ({
    label: p.label,
    value: p.bookings,
  }));
  return (
    <SectionCard title="Sales over time">
      <AreaChart data={data} />
    </SectionCard>
  );
}

/** Section 3 — open-pipeline revenue split by product category (donut). */
export function RevenueByCategoryCard({ crm }: { crm: CrmState }) {
  const rows = revenueByCategory(crm);
  const data = rows.map((r) => ({
    label: r.category,
    value: r.value,
    color: CATEGORY_COLOR[r.category],
  }));
  const openPipeline = computeKpis(crm).openPipeline;
  const centerValue = Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    style: "currency",
    currency: "USD",
  }).format(openPipeline);

  return (
    <SectionCard title="Revenue by category">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No open pipeline to break down yet.
        </p>
      ) : (
        <>
          <DonutChart
            data={data}
            centerValue={centerValue}
            centerLabel="open pipeline"
          />
          <p className="sr-only">
            {formatCurrency(openPipeline)} open pipeline
          </p>
          <div className="flex flex-wrap gap-1.5">
            {rows.map((r) => (
              <span
                key={r.category}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_STYLES[r.category]}`}
              >
                {r.category}
              </span>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}
