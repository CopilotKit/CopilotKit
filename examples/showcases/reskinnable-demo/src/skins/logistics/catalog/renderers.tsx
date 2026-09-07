"use client";

import type { RendererProps } from "@copilotkit/a2ui-renderer";
import { cn } from "@/lib/utils";
import { useBriefData } from "../brief-data";
import {
  deriveKpis,
  ExceptionBoard,
  orderExceptionRows,
  TradeoffTable,
  LanePerformanceChart,
  ExposureByLaneChart,
  DelayTrendChart,
  ModeSplitChart,
} from "../components";
import { computeMitigationOptions } from "../data/mitigation-options";

const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-10" } as const;

// Text props in the catalog are `string | { path }` (a data-bound ref). The
// A2UI runtime resolves refs before render, but the Zod-inferred type still
// carries the union, so coerce to a display string here.
type TextRef = string | { path: string };
const asText = (value: TextRef): string =>
  typeof value === "string" ? value : "";

function Slot({ render }: { render: React.ReactNode }) {
  return <>{render}</>;
}

const Stack = ({
  props,
  children,
}: RendererProps<{ children: string[]; gap?: keyof typeof GAP }>) => (
  <div className={cn("flex flex-col", GAP[props.gap ?? "md"])}>
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Row = ({
  props,
  children,
}: RendererProps<{ children: string[]; gap?: "sm" | "md" | "lg" }>) => (
  <div className={cn("flex flex-wrap", GAP[props.gap ?? "md"])}>
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Grid = ({
  props,
  children,
}: RendererProps<{ children: string[]; columns?: number }>) => (
  <div
    className="grid gap-4"
    style={{
      gridTemplateColumns: `repeat(${props.columns ?? 3}, minmax(0, 1fr))`,
    }}
  >
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Section = ({
  props,
  children,
}: RendererProps<{ title: string; child: string }>) => (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-ink">{props.title}</h2>
    <Slot render={children(props.child)} />
  </section>
);

const Heading = ({ props }: RendererProps<{ text: TextRef }>) => (
  <h1 className="text-2xl font-semibold tracking-tight text-ink">
    {asText(props.text)}
  </h1>
);

const Text = ({
  props,
}: RendererProps<{ text: TextRef; tone?: "default" | "muted" }>) => (
  <p
    className={cn(
      "text-sm",
      props.tone === "muted" ? "text-ink-muted" : "text-ink",
    )}
  >
    {asText(props.text)}
  </p>
);

const METRIC_FORMAT = {
  onTimeRate: (k: ReturnType<typeof deriveKpis>) =>
    `${Math.round(k.onTimeRate * 100)}%`,
  atRiskCount: (k: ReturnType<typeof deriveKpis>) => String(k.atRiskCount),
  exposureUsd: (k: ReturnType<typeof deriveKpis>) =>
    `$${Math.round(k.exposureUsd).toLocaleString("en-US")}`,
  avgDelayDays: (k: ReturnType<typeof deriveKpis>) => `${k.avgDelayDays}d`,
} as const;

const StatCard = ({
  props,
}: RendererProps<{ metric: keyof typeof METRIC_FORMAT; label: TextRef }>) => {
  const { shipments } = useBriefData();
  const kpis = deriveKpis(shipments);
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4 shadow-soft">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {asText(props.label)}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {METRIC_FORMAT[props.metric](kpis)}
      </div>
    </div>
  );
};

const CHARTS = {
  lanePerformance: LanePerformanceChart,
  exposureByLane: ExposureByLaneChart,
  delayTrend: DelayTrendChart,
  modeSplit: ModeSplitChart,
} as const;

const Chart = ({ props }: RendererProps<{ kind: keyof typeof CHARTS }>) => {
  const { shipments, lanes } = useBriefData();
  const Component = CHARTS[props.kind];
  return <Component shipments={shipments} lanes={lanes} />;
};

const ExceptionTable = ({
  props,
}: RendererProps<{ status?: "all" | "at_risk" | "delayed" | "on_track" }>) => {
  const { shipments, lanes } = useBriefData();
  const status = props.status ?? "all";
  // The EXCEPTION table, on all three surfaces that draw this board: the Control
  // Tower page, the `showExceptions` chat card, and this canvas brief. Clean
  // shipments are not queue work and are off all three. This one lagged — it
  // listed every shipment while the other two filtered, so a brief on the canvas
  // could show rows the page beside it denied existed, and the agent prompt
  // asserts "the board holds only shipments carrying an exception".
  const onException = shipments.filter((s) => s.exception);
  const rows =
    status === "all"
      ? onException
      : onException.filter((s) => s.status === status);
  // The board renders what it is handed, in the order it is handed — order here
  // rather than relying on it to sort. See `orderExceptionRows`' header.
  return <ExceptionBoard shipments={orderExceptionRows(rows)} lanes={lanes} />;
};

const TradeoffTableRenderer = ({
  props,
}: RendererProps<{ shipmentId: string }>) => {
  const { shipments, lanes } = useBriefData();
  const shipment = shipments.find(
    (s) => s.id === props.shipmentId || s.reference === props.shipmentId,
  );
  if (!shipment) {
    return (
      <div className="rounded-lg border border-dashed border-hairline p-4 text-sm text-ink-muted">
        Shipment not found.
      </div>
    );
  }
  // authorityUsd is null here: the brief is a read-only artifact, so it shows
  // every option without gating. The gate applies at commit time, in chat.
  return (
    <TradeoffTable
      options={computeMitigationOptions(shipment, lanes)}
      authorityUsd={null}
    />
  );
};

export const renderers = {
  Stack,
  Row,
  Grid,
  Section,
  Heading,
  Text,
  StatCard,
  Chart,
  ExceptionTable,
  TradeoffTable: TradeoffTableRenderer,
};
