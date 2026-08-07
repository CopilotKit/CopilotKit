"use client";

import type { RendererProps } from "@copilotkit/a2ui-renderer";
import { cn } from "@/lib/utils";
import { KpiTile } from "../components/charts/kpi-tile";
import { TrendChart } from "../components/charts/trend-chart";
import { BreakdownChart } from "../components/charts/breakdown-chart";
import { WaterfallChart } from "../components/charts/waterfall-chart";
import { useBoardData } from "../board-data";
import type { MetricId } from "../data/types";

const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-10" } as const;

function Slot({ render }: { render: React.ReactNode }) {
  return <>{render}</>;
}

export const renderers = {
  Stack: ({
    props,
    children,
  }: RendererProps<{ children: string[]; gap?: keyof typeof GAP }>) => (
    <div className={cn("flex flex-col", GAP[props.gap ?? "lg"])}>
      {props.children?.map((id) => (
        <Slot key={id} render={children(id)} />
      ))}
    </div>
  ),

  Grid: ({
    props,
    children,
  }: RendererProps<{ children: string[]; columns?: number }>) => (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, Math.min(props.columns ?? 4, 4))}, minmax(0, 1fr))`,
      }}
    >
      {props.children?.map((id) => (
        <Slot key={id} render={children(id)} />
      ))}
    </div>
  ),

  Heading: ({ props }: RendererProps<{ text: string }>) => (
    <h1 className="text-xl font-semibold tracking-tight text-ink">
      {props.text}
    </h1>
  ),

  Text: ({
    props,
  }: RendererProps<{ text: string; tone?: "default" | "muted" }>) => (
    <p
      className={cn(
        "text-sm",
        props.tone === "muted" ? "text-ink-muted" : "text-ink",
      )}
    >
      {props.text}
    </p>
  ),

  /**
   * Never carries a figure — it looks the metric up in the LIVE board data and
   * renders the same KpiTile the pages use, so the canvas cannot show a number
   * the app disagrees with.
   *
   * The lens props the ops carry are deliberately NOT read here: the canvas
   * reads them once off the op list and binds them on BoardDataProvider, so one
   * board is one fetch. Reading them here would mean a fetch per tile.
   * `useBoardData()` is already the requested slice.
   */
  StatCard: ({ props }: RendererProps<{ metric: string; label: string }>) => {
    const { kpis } = useBoardData();
    const kpi = kpis.find((k) => k.metric === (props.metric as MetricId));
    if (!kpi) return null;
    return <KpiTile kpi={kpi} />;
  },

  /**
   * Switches on `kind` and renders the matching LIVE chart from board data —
   * the same TrendChart/BreakdownChart/WaterfallChart the pages render, so
   * the canvas and the pages cannot drift apart visually. As with StatCard, the
   * lens is bound once by BoardDataProvider, not read from these props.
   */
  Panel: ({ props }: RendererProps<{ kind: string; title: string }>) => {
    const { series, breakdownBySegment, breakdownByRegion, waterfall } =
      useBoardData();
    return (
      <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">{props.title}</h2>
        {props.kind === "trend" && series && <TrendChart series={series} />}
        {props.kind === "breakdown-segment" && (
          <BreakdownChart rows={breakdownBySegment} unit="usd" />
        )}
        {props.kind === "breakdown-region" && (
          <BreakdownChart rows={breakdownByRegion} unit="usd" />
        )}
        {props.kind === "plan-variance" && (
          <WaterfallChart steps={waterfall} unit="usd" />
        )}
      </section>
    );
  },
};
