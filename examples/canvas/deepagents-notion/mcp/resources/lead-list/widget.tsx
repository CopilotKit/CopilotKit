import { useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";
import { Frame } from "../../src/components/Frame";
import { leadSchema, segmentSchema, type Lead, type Segment } from "../../src/lib/leads/types";
import {
  segmentDotClass,
  techLevelClass,
  workshopClass,
} from "../../src/lib/leads/derive";
import { SAMPLE_LEADS, SAMPLE_SEGMENTS } from "../../src/lib/leads/sample";

export const propSchema = z.object({
  leads: z.array(leadSchema).default([]).describe(
    "Lead rows to render. Pass an empty array (or omit) to use the sample dataset.",
  ),
  segments: z.array(segmentSchema).default([]).describe(
    "Optional segments — controls the colored dots in the Segments column.",
  ),
});

export type LeadListWidgetProps = z.infer<typeof propSchema>;

export const widgetMetadata: WidgetMetadata = {
  description:
    "Render the Workshop Lead Triage list view: KPIs on top, table of leads below.",
  props: propSchema,
  exposeAsTool: false,
  metadata: {
    prefersBorder: false,
    invoking: "Loading leads…",
    invoked: "List ready",
  },
};

const LeadListWidget: React.FC = () => {
  const { props } = useWidget<LeadListWidgetProps>();
  const leads: Lead[] = props?.leads?.length ? props.leads : SAMPLE_LEADS;
  const segments: Segment[] = props?.segments?.length
    ? props.segments
    : SAMPLE_SEGMENTS;

  return (
    <Frame leads={leads} view="list">
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/40 dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Role / Company</th>
              <th className="px-3 py-2 font-semibold">Workshop</th>
              <th className="px-3 py-2 font-semibold">Level</th>
              <th className="px-3 py-2 font-semibold">Tools</th>
              <th className="px-3 py-2 font-semibold">Opt-in</th>
              <th className="px-3 py-2 font-semibold">Segments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {leads.map((lead) => {
              const memberOf = segments.filter((s) =>
                s.leadIds.includes(lead.id),
              );
              return (
                <tr key={lead.id}>
                  <td className="px-3 py-2 align-top font-medium">
                    {lead.name}
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {lead.email}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-neutral-600 dark:text-neutral-300">
                    {lead.role}
                    {lead.company ? (
                      <span className="text-neutral-700 dark:text-neutral-200">
                        {" · "}
                        {lead.company}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${workshopClass(lead.workshop)}`}
                    >
                      {lead.workshop}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${techLevelClass(lead.technical_level)}`}
                    >
                      {lead.technical_level}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {lead.tools.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className={`rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 ${
                            t === "CopilotKit"
                              ? "ring-1 ring-blue-500/40"
                              : ""
                          }`}
                        >
                          {t}
                        </span>
                      ))}
                      {lead.tools.length > 3 ? (
                        <span className="text-[10px] text-neutral-500">
                          +{lead.tools.length - 3}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {lead.opt_in ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        ✓
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex gap-1">
                      {memberOf.length === 0 ? (
                        <span className="text-neutral-300 dark:text-neutral-600">—</span>
                      ) : (
                        memberOf.map((s) => (
                          <span
                            key={s.id}
                            title={s.name}
                            className={`size-2 rounded-full ${segmentDotClass(s.color)}`}
                          />
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Frame>
  );
};

export default LeadListWidget;
