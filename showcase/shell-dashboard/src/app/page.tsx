"use client";
// Feature matrix: one row per feature × integration. Each feature's
// `kind` (primary | testing) determines its visual grouping.
// "testing"-kind features render muted and skip the docs row.
import { Suspense, useMemo } from "react";
import { FeatureGrid, type CellContext } from "@/components/feature-grid";
import { CellStatus, urlsFor } from "@/components/cell-pieces";
import { CommandCell } from "@/components/command-cell";
import { FilterBar } from "@/components/filter-bar";
import { useFilterState } from "@/hooks/useFilterState";
import {
  getFeatureCategories,
  getFeatures,
  getIntegrations,
} from "@/lib/registry";

function Cell(ctx: CellContext) {
  const isTesting = ctx.feature.kind === "testing";

  // Informational demo (e.g. cli-start) — renders a copy-pasteable command
  // block in place of the Demo/Code links, but still shows the same docs
  // row + E2E/Smoke/QA/health badges below so the matrix is consistent.
  if (ctx.demo.command) {
    return <CommandCell ctx={ctx} />;
  }

  const links = urlsFor(ctx);

  return (
    <div
      className={`flex flex-col gap-1 text-[11px] ${isTesting ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <a
          href={links.demoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Demo</span> <span>↗</span>
        </a>
        <a
          href={links.codeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Code</span>{" "}
          <span>{"</>"}</span>
        </a>
      </div>
      <CellStatus ctx={ctx} />
    </div>
  );
}

export default function Page() {
  // `useSearchParams()` inside `useFilterState` requires a Suspense boundary
  // under Next.js 15 static rendering, otherwise the page bails out of
  // prerender. Scope the boundary here so the rest of the chrome can SSR.
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const filters = useFilterState();
  const allIntegrations = useMemo(() => getIntegrations(), []);
  const allFeatures = useMemo(() => getFeatures(), []);
  const featureCategories = useMemo(() => getFeatureCategories(), []);

  // Narrow integrations + features by the non-status filters here so the
  // matrix only receives the subset it needs to render. The "only green"
  // filter runs inside FeatureGrid itself because it depends on live status.
  const { visibleIntegrations, visibleFeatures } = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const ints = allIntegrations.filter((i) => {
      if (filters.languages.length && !filters.languages.includes(i.language))
        return false;
      if (
        filters.integrationCategories.length &&
        !filters.integrationCategories.includes(i.category)
      )
        return false;
      return true;
    });
    const feats = allFeatures.filter((f) => {
      if (
        filters.featureCategories.length &&
        !filters.featureCategories.includes(f.category)
      )
        return false;
      return true;
    });

    if (!q) return { visibleIntegrations: ints, visibleFeatures: feats };

    // Search hits EITHER a feature name OR an integration name. When a
    // feature matches, narrow rows but keep all columns (so you can scan
    // "where is this feature supported"). When an integration matches,
    // narrow columns but keep all features ("what's in this integration").
    const featureMatch = feats.filter(
      (f) => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q),
    );
    const integrationMatch = ints.filter(
      (i) =>
        i.name.toLowerCase().includes(q) || i.slug.toLowerCase().includes(q),
    );
    return {
      visibleIntegrations:
        integrationMatch.length > 0 ? integrationMatch : ints,
      visibleFeatures: featureMatch.length > 0 ? featureMatch : feats,
    };
  }, [
    allIntegrations,
    allFeatures,
    filters.q,
    filters.languages,
    filters.integrationCategories,
    filters.featureCategories,
  ]);

  return (
    <>
      <FilterBar
        integrations={allIntegrations}
        featureCategories={featureCategories}
        state={filters}
        actions={filters}
        summary={{
          visibleFeatures: visibleFeatures.length,
          totalFeatures: allFeatures.length,
          visibleIntegrations: visibleIntegrations.length,
          totalIntegrations: allIntegrations.length,
        }}
      />
      <FeatureGrid
        title="Feature Matrix"
        renderCell={Cell}
        minColWidth={200}
        integrations={visibleIntegrations}
        features={visibleFeatures}
        onlyGreen={filters.onlyGreen}
      />
      <Legend />
    </>
  );
}

function Legend() {
  // Aging thresholds below (`<6h`, `<7d`, `<30d`) describe intent /
  // spec §5.4 policy — the probe aging logic lives in the ops service
  // (showcase/ops/src/writers/status-writer.ts) and the values shown
  // here are informational copy, not live-derived. If the probes'
  // "degraded" cutoff changes, update this Legend too (C5 F11).
  return (
    <details className="px-8 pb-8 text-xs text-[var(--text-muted)]">
      <summary className="cursor-pointer select-none text-[var(--text-secondary)] hover:text-[var(--text)]">
        Legend
      </summary>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-secondary)]">testing</span>
          rows are muted &amp; hide docs (primary feature = has docs)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--ok)]">docs-og ✓</span>/
          <span className="text-[var(--danger)]">docs-shell ✗</span>
          doc link present / missing
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--accent)] font-medium">Demo ↗</span>/
          <span className="text-[var(--accent)] font-medium">Code {"</>"}</span>
          open hosted preview / source
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--ok)]">E2E ✓</span>/
          <span className="text-[var(--amber)]">amber</span>/
          <span className="text-[var(--danger)]">✗</span>
          end-to-end (green &lt;6h · amber older · red fail/none)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--ok)]">Smoke ✓</span>
          smoke test, same color rules
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--ok)]">QA 3d</span>
          days since human QA (green &lt;7d · amber &lt;30d · red older/never)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--ok)]" />
            Hosted
          </span>
          dot = live probe, click = open hosted URL
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">?</span>
          live data not yet received (probe pending)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">—</span>
          supported, no demo yet
        </div>
      </div>
    </details>
  );
}
