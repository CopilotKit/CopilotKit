"use client";

import type { RendererProps } from "@copilotkit/a2ui-renderer";
import { cn } from "@/lib/utils";
import { BandLadder } from "../components/band-ladder";
import { Monogram } from "../components/monogram";
import {
  EmptyState,
  Metric,
  Panel,
  Pill,
  SectionLabel,
} from "../components/primitives";
import {
  REQUEST_KIND_LABEL,
  ageInDays,
  bandPosition,
  formatPercent,
  formatSalary,
  isOutOfBand,
  requestValueLabel,
} from "../data/derive";
import { useReportData } from "../report-data";

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

// --- Layout primitives (mirror banking/logistics exactly) -------------------

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

// --- Live, data-bound widgets ----------------------------------------------
// Every figure below is computed HERE from useReportData(), never read from a
// prop. The catalog op only ever named the metric/kind; the numbers are the
// ledger's, so the agent can select but never fabricate.

const StatCard = ({
  props,
}: RendererProps<{
  metric:
    | "headcount"
    | "outOfBandCount"
    | "openRequests"
    | "medianBandPosition";
  label: TextRef;
}>) => {
  const { employees, bands, requests } = useReportData();

  let value = "—";
  let tone: "neutral" | "brand" | "positive" | "negative" = "neutral";

  switch (props.metric) {
    case "headcount":
      value = String(employees.length);
      break;
    case "outOfBandCount": {
      const n = employees.filter((e) => isOutOfBand(bands, e)).length;
      value = String(n);
      // Out-of-band is the exception the whole skin is about — flag it red when
      // there is anything to act on, quiet green when the roster is clean.
      tone = n > 0 ? "negative" : "positive";
      break;
    }
    case "openRequests":
      value = String(requests.filter((r) => r.status === "pending").length);
      tone = "brand";
      break;
    case "medianBandPosition": {
      const ratios = employees
        .map((e) => bandPosition(bands, e.baseSalary, e.level)?.ratio)
        .filter((r): r is number => typeof r === "number")
        .sort((a, b) => a - b);
      if (ratios.length) {
        const mid = Math.floor(ratios.length / 2);
        const median =
          ratios.length % 2 === 0
            ? (ratios[mid - 1] + ratios[mid]) / 2
            : ratios[mid];
        value = formatPercent(median);
      }
      break;
    }
  }

  return <Metric label={asText(props.label)} value={value} tone={tone} />;
};

const LevelBreakdown = () => {
  const { employees, bands } = useReportData();
  if (!employees.length || !bands.length) {
    return (
      <Panel>
        <EmptyState
          title="No roster to plot"
          hint="Once the ledger loads, every person appears on the band ladder at their position within their level."
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionLabel>Level breakdown</SectionLabel>
      <BandLadder bands={bands} employees={employees} />
    </Panel>
  );
};

function OutOfBandList() {
  const { employees, bands } = useReportData();
  const rows = employees.filter((e) => isOutOfBand(bands, e));
  if (!rows.length) {
    return (
      <Panel>
        <SectionLabel>Out of band</SectionLabel>
        <EmptyState
          title="Everyone is inside their band"
          hint="No salary sits outside its level's range — there is nothing to escalate at the review."
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionLabel>Out of band</SectionLabel>
      <ul className="divide-y divide-hairline">
        {rows.map((e) => {
          const pos = bandPosition(bands, e.baseSalary, e.level);
          return (
            <li
              key={e.id}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <Monogram name={e.name} size="sm" ring="negative" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {e.name}
                </div>
                <div className="truncate text-[0.72rem] text-ink-muted">
                  {e.title} · {e.level}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rowan-num text-sm font-semibold text-ink">
                  {formatSalary(e.baseSalary)}
                </span>
                <Pill tone="negative">{pos?.side ?? "out of"} band</Pill>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function OpenRequestsList() {
  const { employees, requests } = useReportData();
  const rows = requests.filter((r) => r.status === "pending");
  if (!rows.length) {
    return (
      <Panel>
        <SectionLabel>Open requests</SectionLabel>
        <EmptyState
          title="The queue is clear"
          hint="No requests are waiting on a decision — the review can skip the queue."
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionLabel>Open requests</SectionLabel>
      <ul className="divide-y divide-hairline">
        {rows.map((r) => {
          const person = employees.find((e) => e.id === r.employeeId);
          const age = ageInDays(r.submittedAt);
          return (
            <li
              key={r.id}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <Monogram name={person?.name ?? "Unknown"} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {person?.name ?? "Unknown"}
                  </span>
                  <Pill tone="brand">{REQUEST_KIND_LABEL[r.kind]}</Pill>
                </div>
                <div className="truncate text-[0.72rem] text-ink-muted">
                  {r.summary}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <span className="rowan-num text-sm font-semibold text-ink">
                  {requestValueLabel(r)}
                </span>
                <span className="text-[0.68rem] text-ink-muted">
                  {age === 0 ? "today" : `${age}d ago`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const PeopleList = ({
  props,
}: RendererProps<{ kind: "outOfBand" | "openRequests" }>) =>
  props.kind === "outOfBand" ? <OutOfBandList /> : <OpenRequestsList />;

export const renderers = {
  Stack,
  Row,
  Grid,
  Section,
  Heading,
  Text,
  StatCard,
  LevelBreakdown,
  PeopleList,
};
