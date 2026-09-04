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
  LedgerSnapshot,
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

/**
 * The rows the fixed exception strip renders — and, by the same call, the rows
 * the page readable reports as on screen.
 *
 * NOT narrowed by audience. This strip is the COMPANY's exception feed, which
 * is exactly why the CFO page deliberately has no copy of it (see
 * `./cfo-dashboard.tsx`: the feed "describes the COMPANY, not the CFO's own
 * pinned metrics"). Two further things force the wider reading:
 *
 *  · The CEO dashboard also carries a seeded `exceptionList` BLOCK, and block
 *    specs carry no audience (`../blocks/build-block-ops.ts`), so that block
 *    lists every breach at the latest period. A narrowed strip put two
 *    different exception counts on one page — with the seeded audiences it was
 *    literally zero above and three below, and the readable then told the
 *    agent `exceptions: []` about a screen showing three.
 *  · `store.ts`'s publish gate already treats that block as covering every
 *    metric (`referencedMetrics` → `includesAll`), which is what makes the CEO
 *    pack refuse on `dsoDays`. A strip that hid what the gate refuses on would
 *    leave the operator reading a clean feed under a blocked publish.
 *
 * An exception whose metric has no def is dropped — the same rule the
 * `ExceptionList` renderer applies — because without a def there is no label
 * to print and no threshold it can be said to have breached.
 */
export function visibleExceptions(
  snapshot: Pick<LedgerSnapshot, "exceptions" | "metricDefs">,
): VisibleException[] {
  return snapshot.exceptions
    .map((exception) => {
      const def = findMetricDef(snapshot.metricDefs, exception.metricId);
      if (!def) return null;
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

  // One list, built once: the strip below RENDERS it and the readable REPORTS
  // it, so the agent can never describe a feed the screen isn't showing.
  const exceptions = visibleExceptions(snapshot);

  // ── WHAT IS VISIBLY ON SCREEN ─────────────────────────────────────────────
  // Not the whole ledger — the pinned block titles in the order the grid
  // renders them, the exception rows actually shown in the feed strip above,
  // and every initiative's status, in the order the RYG strip shows them.
  // That distinction is the beat: the agent describing what the CEO can
  // literally see right now, not a static page description.
  useAgentContext({
    description:
      "The CEO dashboard the user is currently viewing: the pinned block " +
      "titles in the order shown, the exception feed rows (metric, " +
      "department and variance) actually on screen, and every tracked " +
      "initiative's status, in the order shown.",
    value: JSON.stringify({
      page: "ceo-dashboard",
      pinnedBlocks: dashboard.blocks.map((block) => block.spec.title),
      exceptions: exceptions.map((exception) => ({
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
      <ExceptionFeedStrip exceptions={exceptions} skinHref={skinHref} />
      <InitiativeRygStrip initiatives={snapshot.initiatives} />
      <DashboardGrid dashboardId="ceo" />
    </div>
  );
}

export default CeoDashboardPage;
