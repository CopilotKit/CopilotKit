"use client";

import { useMemo } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useExecLedger } from "../data/ledger-context";
import { DashboardGrid } from "../components/dashboard-grid";
import { departmentLabel } from "../data/department-label";
import { reportMissingMetricDef } from "./metric-rows";
import type {
  BlockSpec,
  Department,
  LedgerSnapshot,
  MetricDef,
  MetricId,
} from "../data/types";

/**
 * The CEO dashboard — Vantage's index page.
 *
 * NOTHING BUT THE PINNED-BLOCK GRID (`DashboardGrid`,
 * `../components/dashboard-grid`). Two fixed strips used to sit above it — an
 * exception feed and an initiative RYG strip — but the seeded dashboard also
 * pins an `exceptionList` and an `initiativeTable` block, so the page opened
 * showing both sets of rows twice, once in chrome the agent cannot touch and
 * once in a block it can. For a demo whose entire claim is "the assistant
 * composes this page", static duplicates of the composable blocks were the
 * strongest possible argument against it.
 *
 * The page readable below therefore reports what the GRID shows, and is
 * derived per-kind from the pinned blocks: unpin the exception block and the
 * agent stops claiming exceptions are on screen.
 */

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
 * to print and no threshold it can be said to have breached. The drop is
 * ANNOUNCED, through the same one-shot reporter `filterMetricRows` uses
 * (`./metric-rows`): this is the screen whose whole job is to show every
 * breach, so a breach silently leaving it is the last thing that should
 * happen quietly.
 */
export function visibleExceptions(
  snapshot: Pick<LedgerSnapshot, "exceptions" | "metricDefs">,
): VisibleException[] {
  return snapshot.exceptions
    .map((exception) => {
      const def = findMetricDef(snapshot.metricDefs, exception.metricId);
      if (!def) {
        reportMissingMetricDef(exception.metricId, "visibleExceptions");
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
}

/** One exception row as the page readable publishes it. */
export interface CeoReadableException {
  metric: string;
  department: string;
  period: string;
  /** `null` when the figure cannot be ranked — see `varianceDisplay`. */
  variancePct: number | null;
  varianceDisplay: string;
  explained: boolean;
}

/**
 * The exception rows the readable publishes — the same list the strip renders,
 * restated with the strings the strip actually shows.
 *
 * TWO THINGS THE RAW FIELD ALONE GOT WRONG, both the "readable must say what
 * the screen says" rule the sibling Metrics Explorer readable already follows
 * (`explorerReadableRows`, `./metrics-explorer.tsx`, and keel's
 * `deriveRegisterKpiTiles` before it):
 *
 *  · The card renders `formatVariance(variancePct)` — "+12.0%" — while the
 *    readable carried the bare `0.12`, so an assistant asked to read the
 *    exception feed out loud said "zero point one two".
 *  · A metric planned at zero divides by zero (`variancePct`, `../data/derive`),
 *    giving `Infinity` or `NaN`. JSON holds neither: `JSON.stringify` turns
 *    both into `null`, so the readable said "unknown" about a card plainly
 *    reading "— n/a". The raw field is now nulled DELIBERATELY for exactly
 *    those two values, and `varianceDisplay` carries the answer the screen
 *    gives.
 */
export function ceoReadableExceptions(
  exceptions: readonly VisibleException[],
): CeoReadableException[] {
  return exceptions.map((exception) => ({
    metric: exception.label,
    department: departmentLabel(exception.department),
    period: exception.period,
    variancePct: Number.isFinite(exception.variancePct)
      ? exception.variancePct
      : null,
    varianceDisplay: formatVariance(exception.variancePct),
    explained: exception.explained,
  }));
}

export function CeoDashboardPage() {
  const { snapshot } = useExecLedger();

  const dashboard = snapshot.dashboards.ceo;

  // WHICH KINDS ARE ACTUALLY PINNED. The readable below claims to describe
  // what is on screen, and since the fixed strips came off this page that is
  // no longer guaranteed by the page itself — a reader can unpin either block.
  // Reporting rows from a block that is not there is the one failure this
  // readable exists to prevent: the agent confidently reading out an exception
  // feed the CEO is not looking at.
  const pinnedKinds = useMemo(
    () => new Set<BlockSpec["kind"]>(dashboard.blocks.map((b) => b.spec.kind)),
    [dashboard],
  );

  // One list, built once, and the SAME rows the pinned `exceptionList` block
  // renders — see `visibleExceptions`, whose test pins that agreement.
  //
  // MEMOIZED on the snapshot, because `visibleExceptions` is a linear
  // `findMetricDef` scan of `metricDefs` PER exception — quadratic in the
  // ledger's size — and it re-ran on every render of a page that also holds
  // the dashboard grid. It only ever changes when the snapshot does.
  const exceptions = useMemo(() => visibleExceptions(snapshot), [snapshot]);

  // ── WHAT IS VISIBLY ON SCREEN ─────────────────────────────────────────────
  // Not the whole ledger — the pinned block titles in the order the grid
  // renders them, plus the rows of the two blocks whose contents an assistant
  // is likely to be asked to read out loud, each reported ONLY when its block
  // is actually pinned. That distinction is the beat: the agent describing
  // what the CEO can literally see right now, not a static page description.
  useAgentContext({
    description:
      "The CEO dashboard the user is currently viewing: the pinned block " +
      "titles in the order shown, and — only when the corresponding block is " +
      "pinned — the exception rows (metric, department and variance) and " +
      "tracked initiatives on screen. An absent or empty list means those " +
      "rows are NOT on this screen, not that the ledger has none. Each " +
      "exception's `varianceDisplay` is the string that block shows — quote " +
      "that rather than the raw `variancePct` fraction beside it, which is " +
      "`null` whenever the figure cannot be ranked (a metric planned at " +
      'zero) and the block reads "— n/a".',
    value: JSON.stringify({
      page: "ceo-dashboard",
      pinnedBlocks: dashboard.blocks.map((block) => block.spec.title),
      exceptions: pinnedKinds.has("exceptionList")
        ? ceoReadableExceptions(exceptions)
        : [],
      initiatives: pinnedKinds.has("initiativeTable")
        ? snapshot.initiatives.map((initiative) => ({
            name: initiative.name,
            owner: initiative.owner,
            status: initiative.status,
            note: initiative.note,
          }))
        : [],
    }),
  });

  return (
    <div className="mx-auto max-w-6xl">
      {/*
        The page's own title, matching `./cfo-dashboard.tsx`'s. It is the one
        piece of fixed chrome kept when the strips came off: without it the
        grid started flush against the top and the two dashboards no longer
        looked like the same screen with a different set of blocks on it.
      */}
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          CEO dashboard
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Everything here is pinned — ask Vantage for a metric and pin it.
        </p>
      </header>

      <DashboardGrid dashboardId="ceo" />
    </div>
  );
}

export default CeoDashboardPage;
