"use client";
/**
 * OverlayColumnHeader -- overlay-aware column header that conditionally
 * shows ParityBadge and tally based on active overlays.
 *
 * LevelStrip (U/W/C/T badges) was removed from this component because
 * those badges read integration-level probes (health/agent/chat/tools)
 * which are independent of per-feature cell data and can show
 * contradictory states. The tally derived from buildCellModel is now
 * the sole column summary for the Coverage tab.
 */
import { ParityBadge } from "@/components/parity-badge";
import type { ParityTier } from "@/components/parity-badge";
import { TallyTrigger } from "@/components/tally-breakdown";
import type { TallyDetail } from "@/components/tally-types";
import type { Integration } from "@/lib/registry";
import type { Overlay } from "@/lib/overlay-types";

export interface OverlayColumnHeaderProps {
  integration: Integration;
  tally?: {
    green: number;
    amber: number;
    red: number;
    unknown: boolean;
    // REQUIRED (not optional): the producers — `computeColumnTally` /
    // `computeColumnTallyDetail` — ALWAYS return a concrete `loading` boolean,
    // and `FeatureGrid` always passes it. Keeping it optional was a latent gap:
    // a future caller omitting `loading` would render authoritative ✓0/~0/✗0
    // during an error/loading window (the exact "stale-green lie" this header
    // prevents). The `tally` object itself stays optional; `loading` within it
    // is mandatory once a tally is supplied.
    loading: boolean;
  };
  tallyDetail?: TallyDetail;
  overlays: Set<Overlay>;
  parityTier?: ParityTier;
  /** Minimum column width in pixels. */
  minWidth?: number;
}

export function OverlayColumnHeader({
  integration,
  tally,
  tallyDetail,
  overlays,
  parityTier,
  minWidth = 220,
}: OverlayColumnHeaderProps) {
  const showHealth = overlays.has("health");
  const showParity = overlays.has("parity");

  // `stale` rides on `tallyDetail` (the TallyDetail producer) -- an
  // authoritative result whose feed is mid-reconnect (counts are real but may
  // be behind the live state). Threaded exactly like `loading`, but rendered
  // as a MUTED treatment on the real counts instead of hiding them.
  const stale = tallyDetail?.stale ?? false;

  const total = tally ? tally.green + tally.amber + tally.red : 0;
  const tallyTitle = tally?.loading
    ? "loading -- waiting for the first live signal"
    : tally?.unknown
      ? "dashboard offline -- live signal unavailable"
      : stale
        ? "reconnecting -- counts may be stale"
        : total
          ? `${tally?.green ?? 0} green \u00b7 ${tally?.amber ?? 0} amber \u00b7 ${tally?.red ?? 0} red of ${total} signals`
          : "no countable signals for this column";

  return (
    <th
      className="sticky top-0 z-20 bg-[var(--bg-muted)] px-1 py-1.5 text-center border-b border-l border-[var(--border)] font-normal"
      style={{ minWidth: `${minWidth}px` }}
    >
      {/* Always: integration name */}
      <div className="text-[10px] font-semibold text-[var(--text)]">
        {integration.name}
      </div>

      {/* Always: language */}
      <div className="mt-0.5 text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        {integration.language}
      </div>

      {/* Parity overlay: ParityBadge */}
      {showParity && parityTier && (
        <div className="mt-1">
          <ParityBadge tier={parityTier} />
        </div>
      )}

      {/* Health overlay: tally line */}
      {showHealth && tally && (
        <div
          // A.3 muted treatment: when the counts are authoritative-but-stale
          // (mid-reconnect), dim them (`opacity-60 italic`) so they read as
          // "real, but possibly behind" — distinct from the `loading` pulse
          // and the `offline` affordance. `data-stale` exposes the state for
          // tests and downstream styling. Stale only applies to the
          // authoritative count branch, never to loading/offline.
          data-stale={stale && !tally.loading && !tally.unknown}
          className={`mt-1 text-[9px] tabular-nums text-[var(--text-muted)]${
            stale && !tally.loading && !tally.unknown
              ? " opacity-60 italic"
              : ""
          }`}
          title={tallyTitle}
        >
          {tally.loading ? (
            <span className="text-[var(--text-muted)] animate-pulse">
              {"…"} loading
            </span>
          ) : tally.unknown ? (
            <span className="text-[var(--text-muted)]">? offline</span>
          ) : (
            <>
              <TallyTrigger items={tallyDetail?.green ?? []} tone="green">
                <span className="text-[var(--ok)]">
                  {"\u2713"} {tally.green}
                </span>
              </TallyTrigger>
              <span className="mx-1 text-[var(--text-muted)]">{"\u00b7"}</span>
              <TallyTrigger items={tallyDetail?.amber ?? []} tone="amber">
                <span className="text-[var(--amber)]">~ {tally.amber}</span>
              </TallyTrigger>
              <span className="mx-1 text-[var(--text-muted)]">{"\u00b7"}</span>
              <TallyTrigger items={tallyDetail?.red ?? []} tone="red">
                <span className="text-[var(--danger)]">
                  {"\u2717"} {tally.red}
                </span>
              </TallyTrigger>
            </>
          )}
        </div>
      )}
    </th>
  );
}
