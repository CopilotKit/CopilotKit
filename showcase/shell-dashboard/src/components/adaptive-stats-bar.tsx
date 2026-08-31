"use client";
/**
 * AdaptiveStatsBar — stats bar that shows different stat sections
 * based on which overlays are currently active.
 */

import { CoverageBar } from "./coverage-bar";
import { ParityBadge } from "./parity-badge";
import type { ParityTier } from "./parity-badge";
import type { CatalogData } from "../data/catalog-types";
import type { Overlay } from "@/lib/overlay-types";

/**
 * Depth distribution: count of cells at each achieved depth.
 *
 * Keys mirror the only values `buildCellModel().achievedDepth` can produce
 * (`0 | 3 | 4 | 5 | 6`). There is no d1/d2 bucket — the contiguous-ladder
 * algorithm in cell-model.ts never yields achievedDepth 1 or 2, so those
 * buckets would be permanently 0. `d0` is wired-but-unverified (no passing
 * rung yet); the rendered row includes it so the distribution sums to the
 * wired-cell count.
 */
export interface DepthDistribution {
  d6: number;
  d5: number;
  d4: number;
  d3: number;
  d0: number;
}

/** D6 (parity-vs-reference) rollup counts. */
export interface D6Stats {
  green: number;
  /** Degraded / stale-green D6 cells — surfaced distinctly, not hidden as gray. */
  degraded: number;
  gray: number;
  red: number;
}

export interface AdaptiveStatsBarProps {
  overlays: Set<Overlay>;
  catalog: CatalogData;
  /** Health stats (computed externally) */
  healthStats?: { green: number; amber: number; red: number; noData: number };
  /** Parity tier counts (computed externally) */
  parityStats?: Record<ParityTier, number>;
  /** Docs stats (computed externally) */
  docsStats?: { ok: number; missing: number; notFound: number; error: number };
  /** Depth distribution across wired cells (computed externally) */
  depthDistribution?: DepthDistribution;
  /** D6 parity-vs-reference counts (computed externally) */
  d6Stats?: D6Stats;
}

/* ------------------------------------------------------------------ */
/*  Shared primitives                                                  */
/* ------------------------------------------------------------------ */

/** Large number + small label (mirrors existing StatsBar Stat). */
function Stat({
  value,
  label,
  colorClass,
}: {
  value: number | string;
  label: string;
  colorClass?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={`text-2xl font-bold tabular-nums ${colorClass ?? "text-[var(--text)]"}`}
      >
        {value}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
    </div>
  );
}

/** Compact inline stat — number + label on one line at 10px. */
function MiniStat({
  value,
  label,
  colorClass,
}: {
  value: number | string;
  label: string;
  colorClass?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={`font-bold tabular-nums text-[10px] ${colorClass ?? "text-[var(--text)]"}`}
      >
        {value}
      </span>
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
    </span>
  );
}

/** 1px vertical divider between sections. */
function Divider() {
  return <div className="w-px h-4 bg-[var(--border)]" />;
}

/** Colored dot for health signals. */
function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Section renderers                                                  */
/* ------------------------------------------------------------------ */

function BaseSection({ totalCells }: { totalCells: number }) {
  return (
    <MiniStat
      value={totalCells}
      label="cells"
      colorClass="text-[var(--text-secondary)]"
    />
  );
}

function DepthSection({
  catalog,
  depthDistribution,
}: {
  catalog: CatalogData;
  depthDistribution?: DepthDistribution;
}) {
  const { wired, stub, unshipped } = catalog.metadata;
  // Older catalog.json snapshots may predate the unsupported field; default
  // to 0 so the dashboard renders cleanly against legacy data.
  const unsupported = catalog.metadata.unsupported ?? 0;
  return (
    <div className="flex items-center gap-4">
      <Stat value={wired} label="API (HTTP)" colorClass="text-[var(--ok)]" />
      <Stat value={stub} label="Stub" colorClass="text-[var(--amber)]" />
      <Stat
        value={unshipped}
        label="Unshipped"
        colorClass="text-[var(--text-muted)]"
      />
      <Stat
        value={unsupported}
        label="Unsupported"
        colorClass="text-[var(--text-muted)]"
      />
      <div className="w-24">
        <CoverageBar
          wired={wired}
          stub={stub}
          unshipped={unshipped}
          unsupported={unsupported}
        />
      </div>
      {depthDistribution && (
        <>
          <Divider />
          <DepthDistributionSection distribution={depthDistribution} />
        </>
      )}
    </div>
  );
}

/**
 * Compact depth distribution: D6, D5, D4, D3, D0 counts in a single row.
 *
 * Only depths `buildCellModel().achievedDepth` can produce are shown. D0 (wired
 * but no passing rung yet) is rendered so wired-unverified cells stay visible
 * and the row sums to the "API (HTTP)" count; the never-reachable D1/D2 rows are
 * omitted instead of rendering permanent zeros.
 */
function DepthDistributionSection({
  distribution,
}: {
  distribution: DepthDistribution;
}) {
  const levels: { key: keyof DepthDistribution; label: string }[] = [
    { key: "d6", label: "D6" },
    { key: "d5", label: "D5" },
    { key: "d4", label: "D4" },
    { key: "d3", label: "D3" },
    { key: "d0", label: "D0" },
  ];

  return (
    <div data-testid="depth-distribution" className="flex items-center gap-2">
      {levels.map(({ key, label }) => (
        <span key={key} className="flex items-center gap-0.5">
          <span className="text-[10px] font-semibold text-[var(--accent)] tabular-nums">
            {label}:
          </span>
          <span className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)]">
            {distribution[key]}
          </span>
        </span>
      ))}
    </div>
  );
}

function HealthSection({
  stats,
}: {
  stats: { green: number; amber: number; red: number; noData: number };
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <Dot color="var(--ok)" />
        <MiniStat
          value={stats.green}
          label="green"
          colorClass="text-[var(--ok)]"
        />
      </span>
      <span className="flex items-center gap-1">
        <Dot color="var(--amber)" />
        <MiniStat
          value={stats.amber}
          label="amber"
          colorClass="text-[var(--amber)]"
        />
      </span>
      <span className="flex items-center gap-1">
        <Dot color="var(--danger)" />
        <MiniStat
          value={stats.red}
          label="red"
          colorClass="text-[var(--danger)]"
        />
      </span>
      <span className="flex items-center gap-1">
        <Dot color="var(--text-muted)" />
        <MiniStat
          value={stats.noData}
          label="no data"
          colorClass="text-[var(--text-muted)]"
        />
      </span>
    </div>
  );
}

function ParitySection({ stats }: { stats: Record<ParityTier, number> }) {
  const tiers: ParityTier[] = [
    "reference",
    "at_parity",
    "partial",
    "minimal",
    "not_wired",
  ];

  return (
    <div className="flex items-center gap-3">
      {tiers.map((tier) => (
        <span key={tier} className="flex items-center gap-1">
          <ParityBadge tier={tier} />
          <span className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)]">
            {stats[tier]}
          </span>
        </span>
      ))}
    </div>
  );
}

function D6Section({ stats }: { stats: D6Stats }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <Dot color="var(--ok)" />
        <MiniStat
          value={stats.green}
          label="green"
          colorClass="text-[var(--ok)]"
        />
      </span>
      <span className="flex items-center gap-1">
        <Dot color="var(--amber)" />
        <MiniStat
          value={stats.degraded}
          label="degraded"
          colorClass="text-[var(--amber)]"
        />
      </span>
      <span className="flex items-center gap-1">
        <Dot color="var(--text-muted)" />
        <MiniStat
          value={stats.gray}
          label="gray"
          colorClass="text-[var(--text-muted)]"
        />
      </span>
      <span className="flex items-center gap-1">
        <Dot color="var(--danger)" />
        <MiniStat
          value={stats.red}
          label="red"
          colorClass="text-[var(--danger)]"
        />
      </span>
    </div>
  );
}

function DocsSection({
  stats,
}: {
  stats: { ok: number; missing: number; notFound: number; error: number };
}) {
  return (
    <div className="flex items-center gap-3">
      <MiniStat value={stats.ok} label="ok" colorClass="text-[var(--ok)]" />
      <MiniStat
        value={stats.missing}
        label="missing"
        colorClass="text-[var(--text-muted)]"
      />
      <MiniStat
        value={stats.notFound}
        label="404"
        colorClass="text-[var(--danger)]"
      />
      <MiniStat
        value={stats.error}
        label="error"
        colorClass="text-[var(--amber)]"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function AdaptiveStatsBar({
  overlays,
  catalog,
  healthStats,
  parityStats,
  docsStats,
  depthDistribution,
  d6Stats,
}: AdaptiveStatsBarProps) {
  // Typed as ReactElement (not ReactNode) so each section's stable `key` is
  // readable below — the wrapper reuses it for correct reconciliation when
  // overlays toggle, instead of an array index that shifts as sections appear
  // and disappear.
  const sections: React.ReactElement[] = [];

  // Base — always present
  sections.push(
    <BaseSection key="base" totalCells={catalog.metadata.total_cells} />,
  );

  if (overlays.has("depth")) {
    sections.push(
      <DepthSection
        key="depth"
        catalog={catalog}
        depthDistribution={depthDistribution}
      />,
    );
  }

  if (overlays.has("health") && healthStats) {
    sections.push(<HealthSection key="health" stats={healthStats} />);
  }

  if (overlays.has("parity") && parityStats) {
    sections.push(<ParitySection key="parity" stats={parityStats} />);
  }

  if (overlays.has("docs") && docsStats) {
    sections.push(<DocsSection key="docs" stats={docsStats} />);
  }

  if (overlays.has("d6") && d6Stats) {
    sections.push(<D6Section key="d6" stats={d6Stats} />);
  }

  return (
    <div
      data-testid="adaptive-stats-bar"
      className="px-8 py-3 flex items-center gap-4 border-b border-[var(--border)] bg-[var(--bg-muted)]"
    >
      {sections.map((section, i) => (
        <div key={section.key} className="flex items-center gap-4">
          {i > 0 && <Divider />}
          {section}
        </div>
      ))}
    </div>
  );
}
