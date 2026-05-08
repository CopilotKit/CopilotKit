import { useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";
import { Frame } from "../../src/components/Frame";
import { leadSchema, type Lead } from "../../src/lib/leads/types";
import {
  techLevelBreakdown,
  toolUsage,
  workshopDemand,
  WORKSHOP_BAR,
  TOOL_BAR,
  TECH_STROKE,
  type DemandRow,
} from "../../src/lib/leads/derive";
import { SAMPLE_LEADS } from "../../src/lib/leads/sample";

export const propSchema = z.object({
  leads: z.array(leadSchema).default([]).describe(
    "Lead rows to aggregate. Pass an empty array (or omit) to use the sample dataset.",
  ),
});

export type LeadDemandWidgetProps = z.infer<typeof propSchema>;

export const widgetMetadata: WidgetMetadata = {
  description:
    "Render the Workshop Lead Triage demand view: workshop bars, technical-level donut, and tool usage bars.",
  props: propSchema,
  exposeAsTool: false,
  metadata: {
    prefersBorder: false,
    invoking: "Aggregating leads…",
    invoked: "Demand ready",
  },
};

const LeadDemandWidget: React.FC = () => {
  const { props } = useWidget<LeadDemandWidgetProps>();
  const leads: Lead[] = props?.leads?.length ? props.leads : SAMPLE_LEADS;

  const ws = workshopDemand(leads);
  const tools = toolUsage(leads);
  const tech = techLevelBreakdown(leads);

  return (
    <Frame leads={leads} view="demand">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Section
          title="Workshop demand"
          subtitle="Which workshop should we run next?"
          className="lg:col-span-7"
        >
          <HBar
            rows={ws}
            barClass={(label) => WORKSHOP_BAR[label] ?? "bg-blue-500"}
          />
        </Section>

        <Section
          title="Technical level"
          subtitle="Pitch the right depth"
          className="lg:col-span-5"
        >
          <Donut
            rows={tech}
            colorFor={(label) => TECH_STROKE[label] ?? "stroke-neutral-500"}
          />
          <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
            filter to Developer →
          </p>
        </Section>

        <Section
          title="Tools they're using"
          subtitle="What audience to design content for"
          className="lg:col-span-12"
        >
          <HBar
            rows={tools}
            barClass={(label) =>
              TOOL_BAR[label] ?? "bg-neutral-900 dark:bg-neutral-100"
            }
          />
        </Section>
      </div>
    </Frame>
  );
};

export default LeadDemandWidget;

function Section({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 ${className ?? ""}`}
    >
      <header className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {subtitle}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function HBar({
  rows,
  barClass,
}: {
  rows: DemandRow[];
  barClass: (label: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const pct = (r.count / max) * 100;
        return (
          <li
            key={r.label}
            className="grid grid-cols-[160px_1fr_36px] items-center gap-3"
          >
            <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {r.label}
            </span>
            <span className="relative h-3 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
              <span
                className={`absolute inset-y-0 left-0 rounded ${barClass(r.label)}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-right text-xs font-medium tabular-nums">
              {r.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Donut({
  rows,
  size = 160,
  thickness = 18,
  colorFor,
}: {
  rows: DemandRow[];
  size?: number;
  thickness?: number;
  colorFor: (label: string) => string;
}) {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  let offset = 0;
  const slices = rows.map((r) => {
    const fraction = total === 0 ? 0 : r.count / total;
    const dash = circumference * fraction;
    const gap = circumference - dash;
    const start = offset;
    offset += fraction;
    return { row: r, dash, gap, rotate: start * 360 };
  });

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          className="stroke-neutral-100 dark:stroke-neutral-800"
          strokeWidth={thickness}
        />
        {slices.map((s, i) => (
          <circle
            key={s.row.label + i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            className={colorFor(s.row.label)}
            strokeWidth={thickness}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeLinecap="butt"
            transform={`rotate(${s.rotate - 90} ${cx} ${cy})`}
          />
        ))}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-neutral-900 text-xl font-semibold dark:fill-neutral-50"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-neutral-500 text-[10px] uppercase tracking-wider dark:fill-neutral-400"
        >
          leads
        </text>
      </svg>
      <ul className="flex flex-col gap-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span
              className={`size-2.5 rounded-full ${colorFor(r.label).replace("stroke-", "bg-")}`}
            />
            <span className="text-neutral-500 dark:text-neutral-400">
              {r.label}
            </span>
            <span className="ml-auto pl-3 font-medium tabular-nums">
              {r.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
