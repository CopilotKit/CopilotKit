"use client";
/**
 * StarterCell — ONE cell per starter column (spec §3.4).
 *
 * Replaces the four fixed sub-rows (Health / Agent / Chat / Interaction) the
 * starter block drew before. Those four rows were never a ladder: `health` and
 * `agent` hit the SAME url, `interaction` was the shallowest check of the four
 * and was drawn LAST, and none of them went through `combine()` — so a green
 * `Interaction` chip could and did sit directly above three red ones.
 *
 * This cell is the same object a feature cell is, with a different axis:
 * `buildCellModel(probeAxis: "starter")` → `combine(STARTER_AXIS)` produces the
 * headline depth, and the per-rung detail arrives on `model.ladderRungs`
 * already marked `gated` above the stopping rung. Nothing here re-derives a
 * verdict; it only chooses glyphs for states the engine computed.
 *
 * The headline is an UNMODIFIED `DepthChip` reading `D1` / `D2` / `D3` — no
 * `S` prefix, no `/3` denominator (decided 2026-09-15). `D` means DEPTH and
 * depth is contextual: a starter `D2` and a feature `D2` both mean "the walk
 * reached rung 2 of this cell's ladder", and a cell belongs to exactly one
 * axis, so the two can never collide on one cell. The denominator would be the
 * constant `3` printed on every starter cell in v1 and would read like a score;
 * the three rung marks beneath the chip already show both the ceiling and where
 * the walk stopped.
 *
 * The rung marks are BARE marks with prefixes — the same `Badge` the feature
 * cells' `UI` / `BE` / `1P` / `D6` render through, not a parallel component set.
 */

import type { CellModel, RungView } from "@/lib/cell-model";
import type { BadgeTone } from "@/lib/live-status";
import { DepthChip } from "@/components/depth-chip";
import { Badge, StatusChip } from "@/components/badges";
import { GLYPHS } from "@/lib/glyphs";

/**
 * The `starter_validation:` manifest block, as `generate-registry.ts` passes it
 * through to `registry.json`. Exactly one of the two branches is present on
 * every one of the 21 columns (§3.5): a `path` (+ optional `service`), or
 * `supported: false` with a `reason`.
 */
export interface StarterValidation {
  path?: string;
  service?: string;
  supported?: boolean;
  reason?: string;
}

/**
 * Glyph + tone per rung state. `RungView.state` is `ChipColor | "gated" |
 * "absent"`, and every one of those six maps onto a mark that already exists in
 * the shared vocabulary — this table adds no glyph, it only selects.
 *
 * `gated` is the load-bearing one: `combine` does not CLEAR a rung above the
 * stop, it only declines to CREDIT it, so without the em-dash an independently
 * green S3 would print `D3 ✓` directly under `D2 ✗` — the exact defect this
 * ladder exists to close, relocated one row down.
 */
const RUNG_GLYPH: Record<RungView["state"], { mark: string; tone: BadgeTone }> =
  {
    green: { mark: GLYPHS.pass.mark, tone: "green" },
    amber: { mark: GLYPHS.degraded.mark, tone: "amber" },
    red: { mark: GLYPHS.fail.mark, tone: "red" },
    gray: { mark: GLYPHS.noData.mark, tone: "gray" },
    gated: { mark: GLYPHS.gated.mark, tone: "gray" },
    absent: { mark: GLYPHS.noData.mark, tone: "gray" },
  };

/**
 * The rung's PREFIX in the strip — `D1` / `D2` / `D3`, derived from the rung's
 * own depth so the prefix cannot drift from the ladder. The rung's full label
 * (`D1 http`) and its verbatim assertion live in the mark's hover text and in
 * the cell tooltip; the strip stays as narrow as `UI` / `BE` / `1P` / `D6`.
 */
export function rungPrefix(rung: RungView): string {
  return `D${rung.depth}`;
}

/** Human phrase for a rung state, used in the composed cell tooltip. */
function rungStateWord(state: RungView["state"]): string {
  switch (state) {
    case "green":
      return "pass";
    case "amber":
      return "degraded";
    case "red":
      return "fail";
    case "gated":
      return "gated — blocked by a lower rung, not credited";
    default:
      return "no data";
  }
}

/**
 * The cell tooltip (§3.4 tooltip contract), composed from `ladderRungs` alone:
 *
 *   (a) achieved depth and declared ceiling;
 *   (b) every DECLARED rung, with its state and the verbatim assertion the
 *       driver makes — not a gloss of it;
 *   (c) a rung above the stop reads `gated`, never `✓`;
 *   (d) the stopping rung carries `red since <first_failure_at>` AND its
 *       `fail_count` — a one-tick regression and a 102-day outage were
 *       previously indistinguishable;
 *   (e) `observed_at`, then the designed-but-unrun rungs, verbatim, so a green
 *       `D3` can never be read as "fully verified".
 *
 * Exported pure so it is testable without a DOM.
 */
export function starterCellTooltip(model: CellModel): string {
  const rungs = model.ladderRungs ?? [];
  const lines: string[] = [
    `Starter ladder: D${model.achievedDepth} of ${model.ceilingDepth}`,
  ];
  let freshestObservedAt: string | null = null;
  for (const rung of rungs) {
    const parts = [`${rung.label}: ${rungStateWord(rung.state)}`];
    parts.push(`— ${rung.assertion}`);
    if (rung.state === "red" || rung.state === "amber") {
      if (rung.firstFailureAt) parts.push(`red since ${rung.firstFailureAt}`);
      if (rung.failCount !== null) parts.push(`fail_count ${rung.failCount}`);
      if (rung.errorDesc) parts.push(rung.errorDesc);
    }
    lines.push(parts.join(" "));
    if (rung.observedAt && rung.observedAt > (freshestObservedAt ?? "")) {
      freshestObservedAt = rung.observedAt;
    }
  }
  if (freshestObservedAt) lines.push(`observed_at ${freshestObservedAt}`);
  lines.push("S4 tools, S5 state, S6 UI: designed, not implemented in v1");
  return lines.join("\n");
}

export interface StarterCellProps {
  slug: string;
  model: CellModel;
  /** The column's `starter_validation:` block, for the two absence tooltips. */
  declaration?: StarterValidation;
}

/**
 * One starter column's cell. Three shapes, and which one renders is decided by
 * the ENGINE, never by a render-layer guess:
 *
 *   - NOT SUPPORTED (`supported: false`, from a `supported: false` manifest
 *     branch): the hollow `∅`, tooltipped with the manifest's own `reason`.
 *     This replaces the `🚫` that five of these columns wore falsely.
 *   - NO DATA (supported, but every rung `absent`): the hollow `?`. A column
 *     that declares a starter `path:` and no `service:` has nothing deployed to
 *     probe, so it says exactly that; a provisioned column that has simply not
 *     reported yet gets the vocabulary's own no-data line.
 *   - LIVE: the depth chip, plus the three bare rung marks beneath it.
 */
export function StarterCell({ slug, model, declaration }: StarterCellProps) {
  if (!model.supported) {
    return (
      <StatusChip
        testId={`starter-chip-${slug}`}
        dataAttrs={{ "data-starter-state": "unsupported" }}
        tone="gray"
        size="md"
        label={GLYPHS.notSupported.mark}
        title={
          declaration?.reason ??
          "no starter template exists for this framework — none is expected, and none is counted"
        }
      />
    );
  }

  const rungs = model.ladderRungs ?? [];
  // NO-DATA is "not one rung of this column has ever reported", and the honest
  // test for that is the ROW, not the colour: `foldLadderCell` re-marks every
  // rung above the stop as `gated`, so a never-probed column reads
  // `absent, gated, gated` and an `every(state === "absent")` check would
  // never fire. `observedAt` is non-null exactly when a status row was found.
  const noData = rungs.length > 0 && rungs.every((r) => r.observedAt === null);
  if (noData) {
    const provisioned = Boolean(declaration?.service);
    return (
      <StatusChip
        testId={`starter-chip-${slug}`}
        dataAttrs={{ "data-starter-state": "no-data" }}
        tone="gray"
        size="md"
        label={GLYPHS.noData.mark}
        title={
          provisioned
            ? "the starter probe is configured but has not reported for this column yet"
            : `starter exists in-repo${declaration?.path ? ` at ${declaration.path}` : ""}; no live service provisioned`
        }
      />
    );
  }

  return (
    <div
      data-testid={`starter-cell-${slug}`}
      data-starter-state="ladder"
      className="flex flex-col items-center gap-0.5 text-[11px]"
      title={starterCellTooltip(model)}
    >
      <DepthChip
        chipColor={model.chipColor}
        depth={model.achievedDepth}
        status="wired"
        regression={model.isRegression}
        unreachable={model.surfaceState === "unreachable"}
        pending={model.surfaceState === "pending"}
      />
      <div
        data-testid={`starter-rungs-${slug}`}
        className="flex items-center justify-center gap-2.5"
      >
        {rungs.map((rung) => {
          const glyph = RUNG_GLYPH[rung.state];
          return (
            <Badge
              key={rung.kind}
              name={rungPrefix(rung)}
              state={{ label: glyph.mark, tone: glyph.tone }}
              title={`${rung.label}: ${rungStateWord(rung.state)} — ${rung.assertion}`}
            />
          );
        })}
      </div>
    </div>
  );
}
