"use client";

import { useMemo } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { DashboardGrid } from "../components/dashboard-grid";
import { useExecLedger } from "../data/ledger-context";

/**
 * BEAT 3b — the CFO dashboard's own on-screen readable.
 *
 * The variance-heavy view: a short header plus the pinned-block grid, and
 * nothing else. Unlike the CEO dashboard (`./ceo-dashboard.tsx`), there is no
 * exception feed or initiative RYG strip here — those describe the COMPANY,
 * not the CFO's own pinned metrics, and belong to that page's readable, not
 * this one. Mirrors people's `compensation.tsx`: a page-scoped readable
 * naming exactly what this page renders.
 */
export function CfoDashboardPage() {
  const { snapshot } = useExecLedger();
  const dashboard = snapshot.dashboards.cfo;

  // The most recently published pack FOR THIS DASHBOARD, if any. `packs`
  // holds both dashboards' history, so this is filtered on `dashboardId`
  // before picking the latest `publishedAt` — sorted rather than trusting
  // append order, since a reset/reseed is not guaranteed to preserve it.
  const lastPublishedPack = useMemo(
    () =>
      snapshot.packs
        .filter((pack) => pack.dashboardId === "cfo")
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0] ?? null,
    [snapshot.packs],
  );

  useAgentContext({
    description:
      "The CFO dashboard the user is currently viewing: the pinned blocks, " +
      "in order, and whether this dashboard's board pack has been " +
      "published yet.",
    value: JSON.stringify({
      // "finance", not "cfo": the nav rail's segment for this page (`../nav`)
      // and the value `navigateTo`'s own `segment` enum takes (`../tools.tsx`,
      // ~line 1365). The readable's `page` is the model's handle on where it
      // is, and it is the string it must hand back to navigate here — naming
      // it with a word the navigation vocabulary does not contain makes the
      // round trip fail on a page that looks correctly described.
      page: "finance",
      pinnedBlocks: dashboard.blocks.map((block) => ({
        id: block.id,
        title: block.spec.title,
      })),
      lastPublishedPack: lastPublishedPack
        ? {
            publishedAt: lastPublishedPack.publishedAt,
            blockCount: lastPublishedPack.blockIds.length,
            narrativeCount: lastPublishedPack.narrativeIds.length,
          }
        : null,
    }),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          CFO dashboard
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          The variance-heavy view — pin whatever metric needs a closer look.
        </p>
      </header>

      <DashboardGrid dashboardId="cfo" />
    </div>
  );
}

export default CfoDashboardPage;
