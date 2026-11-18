"use client";

import type { ReactNode } from "react";
import { z } from "zod";
import {
  childList,
  createGenerativeUI,
} from "@copilotkit/react-core/generative-ui";
import { useKeelDesk } from "@/skins/keel/desk-data";
import type { Run } from "@/skins/keel/data/types";
import { StatusPill } from "@/skins/keel/components/status-pill";
import {
  impactBriefDefinitions,
  impactBriefRenderers,
} from "@/skins/keel/canvas/impact-brief-components";

/**
 * The UI of the Keel skin's a2ui report canvas (`canvas-surface.tsx`, the
 * skin's `CanvasSurface`). The shell owns the canvas region, OGUI rendering and
 * surface-kind detection; the canvas only renders keel's OWN a2ui surfaces,
 * with the components below. They bind live desk data via
 * useKeelDesk() (the canvas mounts below `KeelLedgerProvider`, so it reads the
 * same ledger snapshot as the pages), so figures stay live while the ledger poll
 * advances the runs — the agent's ops carry only label-only selections (see
 * ops-report.ts).
 *
 * TWO SURFACES, ONE CATALOG. The canvas renders whichever surface activity
 * (`generative-ui-surface`) is latest, and there are now two kinds:
 *
 *  - the operations report (`keel-ops-report`, built by `ops-report.ts`), whose
 *    figures are LIVE because runs tick;
 *  - beat 3d's filed Impact Brief (`keel-impact-brief`, built by
 *    `canvas/impact-brief-ops.ts`), whose figures are EXPANDED INTO THE OPS
 *    because a filed artifact is immutable and durable — see that file's header
 *    for why that is the same discipline reaching the other answer.
 *
 * Nothing below dispatches between them: `useLatestSurfaceOperations` reads
 * whichever op list arrived, and `usePageSurface` renders it. The two are told
 * apart by surfaceId, never by catalog — both op lists MUST name the same
 * `catalogId` ("keel-report"), the id of `keelReportUI` below, which the skin's
 * UI (`../catalog`) extends so the provider can render it.
 *
 * SCOPE (spec §8): this file, `canvas-surface.tsx` and ops-report.ts are the
 * single DROPPABLE unit.
 * Beat 3d's pair (`canvas/impact-brief-ops.ts` + `canvas/impact-brief-components.tsx`)
 * is droppable on its own: remove the two spreads below and the ops report is
 * untouched.
 */

const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-10" } as const;

// Text props arrive resolved: the generative UI engine resolves a bound prop
// before render, and a binding that names nothing resolves to `undefined`. So
// coerce to a display string here.
type TextRef = string | undefined;
const asText = (value: TextRef): string =>
  typeof value === "string" ? value : "";

/** Whole-minutes duration, or an em dash when no run has completed yet. */
function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** The step a blocked run is waiting on (its awaiting_approval step). */
function blockedStepTitle(run: Run): string {
  return run.steps.find((s) => s.status === "awaiting_approval")?.title ?? "—";
}

/** A dependency-free horizontal bar list, token-styled so it reskins. */
function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  if (!rows.length) {
    return <div className="text-sm text-ink-muted">No data yet.</div>;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-xs text-ink-muted">
            {r.label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-surface-muted">
            <div
              className="h-full rounded-sm bg-brand"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-xs text-ink">
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Report catalog: definitions + live renderers ──────────────────────────────

const stringOrPath = z.string();

const reportDefinitions = {
  Stack: {
    description: "Vertical layout container; the report root.",
    props: z.object({
      children: childList(),
      gap: z.enum(["sm", "md", "lg", "xl"]).optional(),
    }),
  },
  Grid: {
    description: "Responsive grid of KPI tiles or charts.",
    props: z.object({
      children: childList(),
      columns: z.number().int().min(1).max(4).optional(),
    }),
  },
  Heading: {
    description: "The report title — a LABEL ONLY.",
    props: z.object({ text: stringOrPath }),
  },
  Text: {
    description: "A short NEUTRAL caption — label only.",
    props: z.object({
      text: stringOrPath,
      tone: z.enum(["default", "muted"]).optional(),
    }),
  },
  KpiCard: {
    description: "A single live operations KPI tile.",
    props: z.object({
      metric: z.enum([
        "openRuns",
        "blockedRuns",
        "approvalsAwaiting",
        "medianCycleTime",
      ]),
      label: stringOrPath,
    }),
  },
  RunChart: {
    description: "A live operations chart.",
    props: z.object({
      kind: z.enum([
        "throughputByPlaybook",
        "bottleneckByStep",
        "statusBreakdown",
      ]),
    }),
  },
  RunsTable: {
    description: "A live runs table filtered by status.",
    props: z.object({
      filter: z.enum(["all", "blocked", "running", "completed"]).optional(),
    }),
  },
};

const Stack = (props: { children?: ReactNode; gap?: keyof typeof GAP }) => (
  <div className={`flex flex-col ${GAP[props.gap ?? "md"]}`}>
    {props.children}
  </div>
);

const Grid = (props: { children?: ReactNode; columns?: number }) => (
  <div
    className="grid gap-4"
    style={{
      gridTemplateColumns: `repeat(${props.columns ?? 3}, minmax(0, 1fr))`,
    }}
  >
    {props.children}
  </div>
);

const Heading = (props: { text: TextRef }) => (
  <h1 className="text-2xl font-semibold tracking-tight text-ink">
    {asText(props.text)}
  </h1>
);

const Text = (props: { text: TextRef; tone?: "default" | "muted" }) => (
  <p
    className={`text-sm ${props.tone === "muted" ? "text-ink-muted" : "text-ink"}`}
  >
    {asText(props.text)}
  </p>
);

type KpiMetric =
  | "openRuns"
  | "blockedRuns"
  | "approvalsAwaiting"
  | "medianCycleTime";

const KpiCard = (props: { metric: KpiMetric; label: TextRef }) => {
  const { kpis } = useKeelDesk();
  let value = "";
  switch (props.metric) {
    case "openRuns":
      value = String(kpis.openRuns);
      break;
    case "blockedRuns":
      value = String(kpis.blockedRuns);
      break;
    case "approvalsAwaiting":
      value = String(kpis.approvalsForMe);
      break;
    case "medianCycleTime":
      value = formatDuration(kpis.medianCycleTimeMs);
      break;
  }
  return (
    <div className="rounded-md border border-hairline bg-surface p-4 shadow-soft">
      <div className="text-xs uppercase tracking-wide text-ink-muted">
        {asText(props.label)}
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
};

type ChartKind =
  | "throughputByPlaybook"
  | "bottleneckByStep"
  | "statusBreakdown";

const RUN_STATUS_ORDER = [
  "queued",
  "running",
  "blocked",
  "completed",
  "cancelled",
] as const;

const RunChart = (props: { kind: ChartKind }) => {
  const data = useKeelDesk();
  let rows: { label: string; value: number }[] = [];
  switch (props.kind) {
    case "throughputByPlaybook":
      rows = data.playbooks
        .map((p) => ({
          label: p.title,
          value: data.runs.filter((r) => r.playbookId === p.id).length,
        }))
        .filter((r) => r.value > 0);
      break;
    case "bottleneckByStep": {
      const counts = new Map<string, number>();
      for (const run of data.runs.filter((r) => r.status === "blocked")) {
        const title = blockedStepTitle(run);
        counts.set(title, (counts.get(title) ?? 0) + 1);
      }
      rows = [...counts.entries()].map(([label, value]) => ({ label, value }));
      break;
    }
    case "statusBreakdown":
      rows = RUN_STATUS_ORDER.map((status) => ({
        label: status,
        value: data.runs.filter((r) => r.status === status).length,
      })).filter((r) => r.value > 0);
      break;
  }
  return (
    <div className="rounded-md border border-hairline bg-surface p-4 shadow-soft">
      <BarList rows={rows} />
    </div>
  );
};

type RunFilter = "all" | "blocked" | "running" | "completed";

const RunsTable = (props: { filter?: RunFilter }) => {
  const data = useKeelDesk();
  const filter = props.filter ?? "all";
  const rows =
    filter === "all" ? data.runs : data.runs.filter((r) => r.status === filter);
  if (!rows.length) {
    return (
      <div className="rounded-md border border-hairline bg-surface p-4 text-sm text-ink-muted">
        {filter === "all" ? "No runs." : `No ${filter} runs.`}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
            <th className="px-4 py-2 font-medium">Run</th>
            <th className="px-4 py-2 font-medium">Subject</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-hairline last:border-0">
              <td className="px-4 py-2 font-mono text-xs text-ink">{r.id}</td>
              <td className="px-4 py-2 text-ink">{r.subject}</td>
              <td className="px-4 py-2">
                <StatusPill status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// The id MUST equal REPORT_CATALOG_ID in BOTH ops-report.ts and
// canvas/impact-brief-ops.ts ("keel-report"): the surfaces name it as their
// catalogId. The skin's UI (`keelCatalog` in ./catalog) extends this one, so the
// provider accepts the id and renders these components.
export const keelReportUI = createGenerativeUI({
  id: "keel-report",
  components: {
    Stack: { component: Stack, ...reportDefinitions.Stack },
    Grid: { component: Grid, ...reportDefinitions.Grid },
    Heading: { component: Heading, ...reportDefinitions.Heading },
    Text: { component: Text, ...reportDefinitions.Text },
    KpiCard: { component: KpiCard, ...reportDefinitions.KpiCard },
    RunChart: { component: RunChart, ...reportDefinitions.RunChart },
    RunsTable: { component: RunsTable, ...reportDefinitions.RunsTable },
    // Beat 3d's filed Impact Brief. Additive — the ops report neither emits nor
    // sees these, and dropping these three entries leaves it exactly as it was.
    BriefMeta: {
      component: impactBriefRenderers.BriefMeta,
      ...impactBriefDefinitions.BriefMeta,
    },
    BriefCitations: {
      component: impactBriefRenderers.BriefCitations,
      ...impactBriefDefinitions.BriefCitations,
    },
    BriefImpacts: {
      component: impactBriefRenderers.BriefImpacts,
      ...impactBriefDefinitions.BriefImpacts,
    },
  },
});
