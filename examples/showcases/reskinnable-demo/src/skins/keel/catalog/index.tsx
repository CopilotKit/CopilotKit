"use client";

import { z } from "zod";
import { createCatalog } from "@copilotkit/a2ui-renderer";
import type {
  CatalogDefinitions,
  RendererProps,
} from "@copilotkit/a2ui-renderer";
import { Anchor } from "lucide-react";
import type { RunStatus, StepStatus } from "@/skins/keel/data/types";
import { StatusPill } from "@/skins/keel/components/status-pill";

/**
 * The Keel a2ui catalog: a compact run-recap surface the agent can render on the
 * shared canvas. One definition, matching airline's scale. Definitions are
 * platform-agnostic Zod schemas; the renderer is a React component styled with
 * the shared design tokens (StatusPill carries the amber awaiting-approval
 * accent) so it reskins with the theme.
 */

const stepSchema = z.object({
  title: z.string(),
  status: z.enum(["pending", "running", "awaiting_approval", "done", "failed"]),
  role: z.string(),
  approver: z.string().optional(),
});

const definitions = {
  RunSummary: {
    description:
      "A process-run recap card. Use to summarise a run: its title, run id, " +
      "subject and requester, overall status, and each step with its status and " +
      "owning role. Bind the run's real fields — do not invent steps.",
    props: z.object({
      title: z.string(),
      runId: z.string(),
      subject: z.string(),
      requestedBy: z.string(),
      status: z.enum(["queued", "running", "blocked", "completed", "cancelled"]),
      steps: z.array(stepSchema),
      note: z.string().optional(),
    }),
  },
} satisfies CatalogDefinitions;

type RunSummaryProps = {
  title: string;
  runId: string;
  subject: string;
  requestedBy: string;
  status: RunStatus;
  steps: { title: string; status: StepStatus; role: string; approver?: string }[];
  note?: string;
};

export const keelCatalog = createCatalog(
  definitions,
  {
    RunSummary: ({ props }: RendererProps<RunSummaryProps>) => {
      const steps = Array.isArray(props.steps) ? props.steps : [];
      return (
        <div className="rounded-md border border-hairline bg-surface p-6 shadow-soft">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-muted">
                Run <span className="font-mono">{props.runId}</span>
              </div>
              <h2 className="text-lg font-semibold text-ink">{props.title}</h2>
              <div className="mt-0.5 text-sm text-ink-muted">
                {props.subject}
                <span className="ml-2 text-xs">
                  Requested by {props.requestedBy}
                </span>
              </div>
            </div>
            <span className="flex items-center gap-2 text-brand">
              <StatusPill status={props.status} />
              <Anchor className="h-5 w-5" />
            </span>
          </div>

          <ol className="flex flex-col gap-2">
            {steps.map((step, i) => (
              <li
                key={`${step.title}-${i}`}
                className="flex items-center gap-3 rounded-sm border border-hairline px-4 py-2.5"
              >
                <span className="w-6 shrink-0 font-mono text-xs text-ink-muted">
                  {i + 1}
                </span>
                <span className="flex-1 text-sm text-ink">{step.title}</span>
                <span className="text-xs text-ink-muted">{step.role}</span>
                {step.approver ? (
                  <span className="text-xs text-ink-muted">· {step.approver}</span>
                ) : null}
                <StatusPill status={step.status} />
              </li>
            ))}
          </ol>

          {props.note ? (
            <p className="mt-4 border-t border-hairline pt-3 text-sm text-ink-muted">
              {props.note}
            </p>
          ) : null}
        </div>
      );
    },
  },
  { catalogId: "keel", includeBasicCatalog: false },
);
