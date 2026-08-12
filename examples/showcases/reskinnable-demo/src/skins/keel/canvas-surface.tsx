"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  A2UIProvider,
  A2UIRenderer,
  createCatalog,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import type {
  CatalogDefinitions,
  RendererProps,
} from "@copilotkit/a2ui-renderer";
import { useAgent } from "@copilotkit/react-core/v2";
import { useKeelDesk } from "@/skins/keel/desk-data";
import type { Run } from "@/skins/keel/data/types";
import { StatusPill } from "@/skins/keel/components/status-pill";
import { A2UI_OPERATIONS_KEY } from "@/skins/keel/ops-report";
import {
  impactBriefDefinitions,
  impactBriefRenderers,
} from "@/skins/keel/canvas/impact-brief-components";

/**
 * The Keel skin's a2ui report canvas — `skin.CanvasSurface`. The shell owns the
 * canvas region, OGUI rendering and surface-kind detection; this component only
 * renders keel's OWN a2ui surfaces. Its renderers bind live desk data via
 * useKeelDesk() (the canvas mounts below `KeelLedgerProvider`, so it reads the
 * same ledger snapshot as the pages), so figures stay live while the ledger poll
 * advances the runs — the agent's ops carry only label-only selections (see
 * ops-report.ts).
 *
 * TWO SURFACES, ONE CATALOG, ONE PROVIDER. This component renders whichever
 * `a2ui-surface` activity is latest, and there are now two kinds:
 *
 *  - the operations report (`keel-ops-report`, built by `ops-report.ts`), whose
 *    figures are LIVE because runs tick;
 *  - beat 3d's filed Impact Brief (`keel-impact-brief`, built by
 *    `canvas/impact-brief-ops.ts`), whose figures are EXPANDED INTO THE OPS
 *    because a filed artifact is immutable and durable — see that file's header
 *    for why that is the same discipline reaching the other answer.
 *
 * Nothing below dispatches between them: `useReportSurface` reads the surfaceId
 * out of whichever op list arrived, and the a2ui provider keys its surfaces by
 * that id. The two are told apart by surfaceId, never by catalog — one
 * `A2UIProvider` is mounted here, so both op lists MUST name the same
 * `catalogId` ("keel-report").
 *
 * SCOPE (spec §8): this file + ops-report.ts are the single DROPPABLE unit.
 * Beat 3d's pair (`canvas/impact-brief-ops.ts` + `canvas/impact-brief-components.tsx`)
 * is droppable on its own: remove the two spreads below and the ops report is
 * untouched.
 */

type A2UIOp = Record<string, unknown> & { version?: string };

const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-10" } as const;

// Text props in the catalog are `string | { path }` (a data-bound ref). The
// runtime resolves refs before render, but the Zod-inferred type still carries
// the union, so coerce to a display string here.
type TextRef = string | { path: string };
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

const stringOrPath = z.union([z.string(), z.object({ path: z.string() })]);

const reportDefinitions = {
  Stack: {
    description: "Vertical layout container; the report root.",
    props: z.object({
      children: z.array(z.string()),
      gap: z.enum(["sm", "md", "lg", "xl"]).optional(),
    }),
  },
  Grid: {
    description: "Responsive grid of KPI tiles or charts.",
    props: z.object({
      children: z.array(z.string()),
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
  // Beat 3d's filed Impact Brief. Additive — the ops report neither emits nor
  // sees these, and dropping this spread leaves it exactly as it was.
  ...impactBriefDefinitions,
} satisfies CatalogDefinitions;

const Stack = ({
  props,
  children,
}: RendererProps<{ children: string[]; gap?: keyof typeof GAP }>) => (
  <div className={`flex flex-col ${GAP[props.gap ?? "md"]}`}>
    {props.children?.map((id) => (
      <Fragment key={id}>{children(id)}</Fragment>
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
      <Fragment key={id}>{children(id)}</Fragment>
    ))}
  </div>
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

const KpiCard = ({
  props,
}: RendererProps<{ metric: KpiMetric; label: TextRef }>) => {
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

const RunChart = ({ props }: RendererProps<{ kind: ChartKind }>) => {
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

const RunsTable = ({ props }: RendererProps<{ filter?: RunFilter }>) => {
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

// catalogId MUST equal REPORT_CATALOG_ID in BOTH ops-report.ts and
// canvas/impact-brief-ops.ts ("keel-report"); one provider serves both surfaces.
const reportCatalog = createCatalog(
  reportDefinitions,
  {
    Stack,
    Grid,
    Heading,
    Text,
    KpiCard,
    RunChart,
    RunsTable,
    ...impactBriefRenderers,
  },
  { catalogId: "keel-report", includeBasicCatalog: false },
);

// ── Surface plumbing (mirrors banking's canvas-surface.tsx) ───────────────────

type MaybeActivityMessage = {
  role?: string;
  activityType?: string;
  content?: Record<string, unknown>;
};

/** Read the surfaceId out of an A2UI operation list (any op kind). */
function extractSurfaceId(ops: A2UIOp[]): string | null {
  for (const op of ops) {
    const target = (op.createSurface ??
      op.updateComponents ??
      op.updateDataModel) as { surfaceId?: string } | undefined;
    if (target?.surfaceId) return target.surfaceId;
  }
  return null;
}

/**
 * The latest A2UI report surface in the agent's message stream. The A2UI
 * middleware turns the render_ops_report tool result into an `a2ui-surface`
 * activity carrying `a2ui_operations`; we read it straight from `agent.messages`,
 * the pattern the framework's own renderer uses.
 */
function useReportSurface(): {
  operations: A2UIOp[];
  surfaceId: string | null;
} {
  const { agent } = useAgent();
  const messages = agent?.messages as MaybeActivityMessage[] | undefined;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (
        message?.role === "activity" &&
        message?.activityType === "a2ui-surface"
      ) {
        const operations =
          (message.content?.[A2UI_OPERATIONS_KEY] as A2UIOp[]) ?? [];
        return {
          operations,
          surfaceId: operations.length ? extractSurfaceId(operations) : null,
        };
      }
    }
  }
  return { operations: [], surfaceId: null };
}

export function KeelCanvasSurface() {
  return (
    <A2UIProvider catalog={reportCatalog}>
      <CanvasInner />
    </A2UIProvider>
  );
}

function CanvasInner() {
  const { operations, surfaceId } = useReportSurface();
  const hasContent = operations.length > 0 && !!surfaceId;
  // Processing failures surface here (full-region), not just to the console —
  // the canvas owns the whole page, so a blank region with no explanation is
  // the worst outcome. Cleared on the next successful processMessages.
  const [error, setError] = useState<string | null>(null);

  // The error panel describes ONE surface's failed render, and only
  // SurfaceMessageProcessor clears it (via onError(null)) — but that component
  // renders only while surfaceId is truthy. If the latest a2ui-surface activity
  // arrives with empty operations, surfaceId goes null and the processor
  // unmounts, leaving nothing to retry and no one to clear the panel. Reset the
  // error whenever surfaceId changes (React's sanctioned "adjust state during
  // render" pattern — no effect, so no cascading re-render) so the panel can
  // never outlive the surface it describes; the retry within a single surface
  // is unaffected (surfaceId is unchanged, so SurfaceMessageProcessor still owns
  // clearing it on the next successful processMessages).
  const [prevSurfaceId, setPrevSurfaceId] = useState(surfaceId);
  if (surfaceId !== prevSurfaceId) {
    setPrevSurfaceId(surfaceId);
    setError(null);
  }

  return (
    <>
      {surfaceId ? (
        <SurfaceMessageProcessor
          operations={operations}
          surfaceId={surfaceId}
          onError={setError}
        />
      ) : null}
      {error ? (
        <CanvasError message={error} />
      ) : hasContent ? (
        <div className="h-full overflow-y-auto">
          <div className="a2ui-surface p-6 md:p-8" data-testid="a2ui-surface">
            <A2UIRenderer surfaceId={surfaceId} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Full-region, token-styled failure state for a report that could not render. */
function CanvasError({ message }: { message: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8">
        <div
          className="rounded-lg border border-hairline bg-negative-soft p-6 shadow-soft"
          data-testid="a2ui-surface-error"
        >
          <h2 className="text-lg font-semibold text-negative">
            Report failed to render
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            The operations report could not be processed. It will retry
            automatically when the agent sends a corrected report.
          </p>
          <p className="mt-4 rounded-md border border-hairline bg-surface p-3 font-mono text-xs text-ink-muted">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Feeds the surface's operations into the A2UI provider. The activity content
 * carries the FULL operation list on each snapshot, so we strip a duplicate
 * createSurface once the surface exists (the MessageProcessor throws on it) and
 * skip re-processing identical op lists. Mirrors banking's canvas.
 *
 * The op-list hash is latched only AFTER a successful processMessages, so a
 * throw stays retryable and a corrected op list self-heals; the failure is
 * reported to the parent via `onError` (which renders a visible error state)
 * rather than swallowed into the console.
 */
function SurfaceMessageProcessor({
  operations,
  surfaceId,
  onError,
}: {
  operations: A2UIOp[];
  surfaceId: string;
  onError: (message: string | null) => void;
}) {
  const { processMessages, getSurface } = useA2UIActions();
  const lastHashRef = useRef("");

  useEffect(() => {
    if (!operations.length) return;
    const hash = JSON.stringify(operations);
    if (hash === lastHashRef.current) return;

    const isExisting = !!getSurface(surfaceId);
    const ops = isExisting
      ? operations.filter((op) => !("createSurface" in op))
      : operations;
    if (!ops.length) return;
    try {
      processMessages(ops as Array<Record<string, unknown>>);
      // Latch only on success so a failed op list remains retryable.
      lastHashRef.current = hash;
      onError(null);
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : "The operations report could not be processed.",
      );
    }
  }, [operations, processMessages, getSurface, surfaceId, onError]);

  return null;
}

export default KeelCanvasSurface;
