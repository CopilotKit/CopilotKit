"use client";

import Link from "next/link";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useSkinHref } from "@/shell/skin-path";
import { useExecLedger } from "../data/ledger-context";
import { DashboardGrid } from "../components/dashboard-grid";
import { execNavTarget } from "../nav-target";
import type {
  Department,
  Initiative,
  MetricDef,
  MetricId,
} from "../data/types";

/**
 * The CEO dashboard — Vantage's index page.
 *
 * Two FIXED strips sit above the customizable pinned-block grid
 * (`DashboardGrid`, `../components/dashboard-grid`): the exception feed (this
 * period's breaches) and the initiative RYG strip. Unlike a pinned block,
 * neither is agent-configurable or removable — they read straight off
 * `useExecLedger().snapshot` so they are always current and never depend on
 * anything having been pinned.
 */

const DEPARTMENT_LABEL: Record<Department | "all", string> = {
  manufacturing: "Manufacturing",
  distribution: "Distribution",
  "field-services": "Field services",
  corporate: "Corporate",
  all: "Company-wide",
};

const INITIATIVE_STATUS_STYLE: Record<Initiative["status"], string> = {
  red: "border-l-negative bg-negative-soft/40",
  yellow: "border-l-brand bg-brand-soft/40",
  green: "border-l-positive bg-positive-soft/40",
};

const INITIATIVE_STATUS_PILL: Record<Initiative["status"], string> = {
  red: "bg-negative-soft text-negative",
  yellow: "bg-brand-soft text-brand",
  green: "bg-positive-soft text-positive",
};

function findMetricDef(
  defs: MetricDef[],
  metricId: MetricId,
): MetricDef | undefined {
  return defs.find((def) => def.id === metricId);
}

/** Signed variance, matching the catalog's `Delta` glyph convention. */
function formatVariance(value: number): string {
  if (!Number.isFinite(value)) return "— n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  return `${sign}${Math.abs(value * 100).toFixed(1)}%`;
}

export interface VisibleException {
  metricId: MetricId;
  label: string;
  department: Department | "all";
  period: string;
  variancePct: number;
  explained: boolean;
}

export function ExceptionFeedStrip({
  exceptions,
  skinHref,
}: {
  exceptions: VisibleException[];
  /** Built from `useSkinHref("exec")` — every in-skin link goes through it. */
  skinHref: (path?: string) => string;
}) {
  if (exceptions.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-hairline bg-surface-muted px-4 py-3 text-sm text-ink-muted">
        No exceptions this period — everything is within threshold.
      </div>
    );
  }
  return (
    <div className="mb-4 flex gap-3 overflow-x-auto pb-1">
      {exceptions.map((exception) => (
        <Link
          key={`${exception.metricId}-${exception.department}`}
          href={skinHref(
            execNavTarget({
              segment: "metrics",
              department: exception.department,
              period: exception.period,
              threshold: true,
            }),
          )}
          className="flex min-w-[13rem] flex-none flex-col gap-1 rounded-xl border border-hairline bg-surface px-3 py-2 shadow-soft transition-shadow hover:shadow-lift"
        >
          <span className="truncate text-[0.65rem] font-medium uppercase tracking-[0.1em] text-ink-muted">
            {exception.label} · {DEPARTMENT_LABEL[exception.department]}
          </span>
          <div className="flex items-baseline justify-between gap-2">
            {/*
              Every card in this strip is, by construction, a BREACH —
              `data/store.ts`'s `exceptions()` only ever includes points past
              `isBreach`'s |variance| threshold, in either direction — so this
              is never "good news, colored red": it is always the metric the
              CEO needs to look at. It shipped colored by SIGN instead
              (`variancePct > 0` → positive/green), which painted an
              over-plan breach (e.g. opex running hot) the SAME green as an
              on-plan metric, while the Metrics Explorer colors that identical
              number red via `row.breaching` (`./metrics-explorer.tsx`) — two
              screens disagreeing about whether the same figure is bad. The
              sign itself still shows, via `formatVariance`; only the color
              is now "this breached" rather than "this was positive".
            */}
            <span className="text-sm font-semibold tabular-nums text-negative">
              {formatVariance(exception.variancePct)}
            </span>
            <span className="text-[0.65rem] text-ink-muted">
              {exception.explained ? "Explained" : "Unexplained"}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function InitiativeRygStrip({ initiatives }: { initiatives: Initiative[] }) {
  if (initiatives.length === 0) {
    return (
      <div className="mb-5 rounded-xl border border-dashed border-hairline bg-surface-muted px-4 py-3 text-sm text-ink-muted">
        No initiatives tracked.
      </div>
    );
  }
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {initiatives.map((initiative) => (
        <div
          key={initiative.id}
          className={cn(
            "flex min-w-[13rem] max-w-xs flex-1 flex-col gap-0.5 rounded-lg border border-l-4 border-hairline bg-surface px-3 py-2 shadow-soft",
            INITIATIVE_STATUS_STYLE[initiative.status],
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-ink">
              {initiative.name}
            </span>
            <span
              className={cn(
                "flex-none rounded-full px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.1em]",
                INITIATIVE_STATUS_PILL[initiative.status],
              )}
            >
              {initiative.status}
            </span>
          </div>
          <span className="truncate text-xs text-ink-muted">
            {initiative.owner}
          </span>
          {initiative.note ? (
            <span className="line-clamp-2 text-[0.72rem] text-ink-muted">
              {initiative.note}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function CeoDashboardPage() {
  const { snapshot } = useExecLedger();
  // Every in-skin link goes through `useSkinHref` — never a hardcoded
  // `/exec/...` — so the exception feed's drill-in links resolve correctly
  // under a `LOCK_SKIN=exec` deploy too.
  const skinHref = useSkinHref("exec");

  const dashboard = snapshot.dashboards.ceo;

  // The CEO's fixed exception strip narrows to metrics tagged for the CEO
  // audience (or "both"), the same narrowing the `ExceptionList` A2UI
  // renderer applies for an agent-pinned CEO-scoped block — so the always-on
  // strip never shows a CFO-only metric the CEO dashboard's own pinned
  // blocks would filter out.
  const visibleExceptions: VisibleException[] = snapshot.exceptions
    .map((exception) => {
      const def = findMetricDef(snapshot.metricDefs, exception.metricId);
      if (!def || (def.audience !== "ceo" && def.audience !== "both")) {
        return null;
      }
      return {
        metricId: exception.metricId,
        label: def.label,
        department: exception.department,
        period: exception.period,
        variancePct: exception.variancePct,
        explained: exception.explained,
      };
    })
    .filter((row): row is VisibleException => row !== null);

  // ── WHAT IS VISIBLY ON SCREEN ─────────────────────────────────────────────
  // Not the whole ledger — the pinned block titles in the order the grid
  // renders them, the exception rows actually shown in the feed strip above
  // (already narrowed to the CEO audience), and every initiative's status, in
  // the order the RYG strip shows them. That distinction is the beat: the
  // agent describing what the CEO can literally see right now, not a static
  // page description.
  useAgentContext({
    description:
      "The CEO dashboard the user is currently viewing: the pinned block " +
      "titles in the order shown, the exception feed rows (metric, " +
      "department and variance) actually on screen, and every tracked " +
      "initiative's status, in the order shown.",
    value: JSON.stringify({
      page: "ceo-dashboard",
      pinnedBlocks: dashboard.blocks.map((block) => block.spec.title),
      exceptions: visibleExceptions.map((exception) => ({
        metric: exception.label,
        department: DEPARTMENT_LABEL[exception.department],
        period: exception.period,
        variancePct: exception.variancePct,
        explained: exception.explained,
      })),
      initiatives: snapshot.initiatives.map((initiative) => ({
        name: initiative.name,
        owner: initiative.owner,
        status: initiative.status,
        note: initiative.note,
      })),
    }),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <ExceptionFeedStrip exceptions={visibleExceptions} skinHref={skinHref} />
      <InitiativeRygStrip initiatives={snapshot.initiatives} />
      <DashboardGrid dashboardId="ceo" />
    </div>
  );
}

export default CeoDashboardPage;
