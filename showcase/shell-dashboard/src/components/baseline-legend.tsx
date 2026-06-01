"use client";
/**
 * BaselineLegend — fixed-bottom bar showing all status icons and tag badges
 * with labels. Serves as the badge key for the Baseline tab.
 */

import {
  TAGS,
  TAG_BADGE_CONFIG,
  STATUS_CONFIG,
  BaselineStatus,
  STATUSES,
} from "@/lib/baseline-types";

/* ------------------------------------------------------------------ */
/*  Tag display names                                                  */
/* ------------------------------------------------------------------ */

const TAG_DISPLAY_NAMES: Record<string, string> = {
  cpk: "CPK",
  agui: "AG-UI",
  int: "INT",
  demo: "DEMO",
  docs: "DOCS",
  tests: "TESTS",
  all: "ALL",
};

/* ------------------------------------------------------------------ */
/*  Status display labels                                              */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<BaselineStatus, string> = {
  works: "Works",
  possible: "Possible",
  impossible: "Impossible",
  unknown: "Unknown",
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusEntry({ status }: { status: BaselineStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div className="flex items-center gap-1">
      <span>{cfg.emoji}</span>
      <span style={{ color: cfg.color }}>{STATUS_LABELS[status]}</span>
    </div>
  );
}

function TagBadgeEntry({ tag }: { tag: (typeof TAGS)[number] }) {
  const cfg = TAG_BADGE_CONFIG[tag];
  return (
    <div className="flex items-center gap-1">
      <span
        style={{
          width: 13,
          height: 13,
          borderRadius: 2,
          backgroundColor: cfg.bgColor,
          color: cfg.color,
          fontSize: 7,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        {cfg.label}
      </span>
      <span>{TAG_DISPLAY_NAMES[tag] ?? tag.toUpperCase()}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function BaselineLegend() {
  return (
    <div
      data-testid="baseline-legend"
      className="fixed bottom-0 left-0 right-0 z-30 bg-[var(--bg-surface)] border-t border-[var(--border)] px-8 py-2 flex items-center gap-6 text-[11px] text-[var(--text-muted)]"
    >
      {/* Status section */}
      <span className="uppercase text-[9px] font-semibold tracking-wider opacity-60">
        Status
      </span>
      {STATUSES.map((s) => (
        <StatusEntry key={s} status={s} />
      ))}

      {/* Divider */}
      <div className="w-px h-4 bg-[var(--border)]" />

      {/* Tags section */}
      <span className="uppercase text-[9px] font-semibold tracking-wider opacity-60">
        Tags
      </span>
      {TAGS.map((t) => (
        <TagBadgeEntry key={t} tag={t} />
      ))}
    </div>
  );
}
