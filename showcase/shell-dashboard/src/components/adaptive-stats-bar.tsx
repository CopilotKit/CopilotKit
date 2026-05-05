"use client";
/**
 * AdaptiveStatsBar — stats bar that shows different stat sections
 * based on which overlays are currently active.
 */

import { CoverageBar } from "./coverage-bar";
import { ParityBadge } from "./parity-badge";
import type { ParityTier } from "./parity-badge";
import type { CatalogData } from "../data/catalog-types";

type Overlay = "links" | "depth" | "health" | "parity" | "docs";

/** Depth distribution: count of cells at each depth level. */
export interface DepthDistribution {
  d5: number;
  d4: number;
  d3: number;
  d2: number;
  d1: number;
  d0: number;
}

export interface AdaptiveStatsBarProps {
  overlays: Set<Overlay>;
  catalog: CatalogData;
  /** Health stats (computed externally) */
  healthStats?: { green: number; amber: number; red: number };
  /** Parity tier counts (computed externally) */
  parityStats?: Record<ParityTier, number>;
  /** Docs stats (computed externally) */
  docsStats?: { ok: number; missing: number; notFound: number; error: number };
  /** Depth distribution across wired cells (computed externally) */
  depthDistribution?: DepthDistribution;
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
      <Stat value={wired} label="Wired" colorClass="text-[var(--ok)]" />
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

/** Compact depth distribution: D5..D1 counts in a single row. */
function DepthDistributionSection({
  distribution,
}: {
  distribution: DepthDistribution;
}) {
  const levels: { key: keyof DepthDistribution; label: string }[] = [
    { key: "d5", label: "D5" },
    { key: "d4", label: "D4" },
    { key: "d3", label: "D3" },
    { key: "d2", label: "D2" },
    { key: "d1", label: "D1" },
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
  stats: { green: number; amber: number; red: number };
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
}: AdaptiveStatsBarProps) {
  const sections: React.ReactNode[] = [];

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

  return (
    <div
      data-testid="adaptive-stats-bar"
      className="px-8 py-3 flex items-center gap-4 border-b border-[var(--border)] bg-[var(--bg-muted)]"
    >
      {sections.map((section, i) => (
        <div key={i} className="flex items-center gap-4">
          {i > 0 && <Divider />}
          {section}
        </div>
      ))}
    </div>
  );
}
