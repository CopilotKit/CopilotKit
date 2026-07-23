import { useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";
import { Frame } from "../../src/components/Frame";
import {
  leadSchema,
  segmentSchema,
  STATUSES,
  type Lead,
  type Segment,
} from "../../src/lib/leads/types";
import {
  groupByStatus,
  initials,
  segmentDotClass,
  statusClass,
  techLevelClass,
  workshopClass,
} from "../../src/lib/leads/derive";
import { SAMPLE_LEADS, SAMPLE_SEGMENTS } from "../../src/lib/leads/sample";

export const propSchema = z.object({
  leads: z.array(leadSchema).default([]).describe(
    "Lead rows to render. Pass an empty array (or omit) to use the sample dataset.",
  ),
  segments: z.array(segmentSchema).default([]).describe(
    "Optional segments — controls colored dots on lead cards.",
  ),
});

export type LeadPipelineWidgetProps = z.infer<typeof propSchema>;

export const widgetMetadata: WidgetMetadata = {
  description:
    "Render the Workshop Lead Triage pipeline view: kanban columns by status (read-only).",
  props: propSchema,
  exposeAsTool: false,
  metadata: {
    prefersBorder: false,
    invoking: "Loading pipeline…",
    invoked: "Pipeline ready",
  },
};

const LeadPipelineWidget: React.FC = () => {
  const { props } = useWidget<LeadPipelineWidgetProps>();
  const leads: Lead[] = props?.leads?.length ? props.leads : SAMPLE_LEADS;
  const segments: Segment[] = props?.segments?.length
    ? props.segments
    : SAMPLE_SEGMENTS;
  const groups = groupByStatus(leads);
  const segmentByLead = (id: string) =>
    segments.filter((s) => s.leadIds.includes(id));

  return (
    <Frame leads={leads} view="pipeline">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {STATUSES.map((s) => {
          const list = groups[s] ?? [];
          return (
            <section
              key={s}
              className="flex min-h-[200px] flex-col rounded-xl border border-neutral-200 bg-neutral-50/40 dark:border-neutral-800 dark:bg-neutral-900/40"
            >
              <header className="flex items-center justify-between gap-2 border-b border-neutral-200/70 px-3 py-2.5 dark:border-neutral-800/70">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${statusClass(s)}`}
                >
                  {s}
                </span>
                <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-neutral-500 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800">
                  {list.length}
                </span>
              </header>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {list.length === 0 ? (
                  <div className="grid place-items-center py-8 text-[11px] text-neutral-400">
                    empty
                  </div>
                ) : (
                  list.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      segments={segmentByLead(lead.id)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </Frame>
  );
};

export default LeadPipelineWidget;

function LeadCard({ lead, segments }: { lead: Lead; segments: Segment[] }) {
  return (
    <div className="relative flex flex-col gap-2.5 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      {segments.length > 0 ? (
        <div className="absolute right-2 top-2 flex gap-1">
          {segments.slice(0, 4).map((s) => (
            <span
              key={s.id}
              title={s.name}
              className={`size-2 rounded-full ${segmentDotClass(s.color)}`}
            />
          ))}
        </div>
      ) : null}
      <div className="flex items-start gap-2.5">
        <Avatar name={lead.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight">
            {lead.name}
          </div>
          <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {lead.role}
            {lead.company ? ` @ ${lead.company}` : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${workshopClass(lead.workshop)}`}
        >
          {lead.workshop}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${techLevelClass(lead.technical_level)}`}
        >
          {lead.technical_level}
        </span>
      </div>

      {lead.tools.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {lead.tools.slice(0, 5).map((t) => (
            <span
              key={t}
              className={`rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 ${
                t === "CopilotKit" ? "ring-1 ring-blue-500/40" : ""
              }`}
            >
              {t}
            </span>
          ))}
          {lead.tools.length > 5 ? (
            <span className="text-[10px] text-neutral-500">
              +{lead.tools.length - 5}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
        <span className="truncate">✉ {lead.email}</span>
        {lead.opt_in ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            ✓ opt-in
          </span>
        ) : (
          <span className="text-neutral-400">no opt-in</span>
        )}
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return (
    <div
      className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: `hsl(${hue} 45% 50%)` }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
