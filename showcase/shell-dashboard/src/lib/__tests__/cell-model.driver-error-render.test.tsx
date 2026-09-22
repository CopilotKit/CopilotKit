import { unitPillSignal } from "../../../../harness/src/shared/cell-model/cell-model.equivalence-fixtures";
/**
 * U7 REAL-SURFACE PROOF (spec §7.1).
 *
 * The unit suite in `cell-model.test.ts` proves the gray-fold logic against
 * hand-built rows. This file closes the spec's real-surface requirement: it
 * loads PB status rows shaped EXACTLY as the harness drivers persist them
 * (`fixtures/driver-error-rows.json`, captured from the d6-all-pills /
 * d4-chat-roundtrip write shapes — see that file's `_fixture` provenance),
 * runs them through the real `buildCellModel`, and RENDERS the resulting chip
 * via the real `DepthChip` component (the same `chipColor={model.chipColor}`
 * prop `unified-cell.tsx` passes). The DOM assertion confirms the rows that
 * carry a `driver-error`/`abort` infra signal actually paint GRAY, while a
 * genuine `selector-timeout` assertion failure still paints the danger RED —
 * proving the fold is visible end-to-end at the render surface, not just in a
 * unit return value.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildCellModel, E2E_STALE_AFTER_MS } from "../cell-model";
import type { StatusRow, LiveStatusMap } from "../live-status";
import { DepthChip } from "@/components/depth-chip";
import fixture from "./fixtures/driver-error-rows.json";

// The gray no-data fill (chipColorToClass → "gray") and the danger red fill
// (→ "red"), straight from depth-chip.tsx. Asserting on these class fragments
// is asserting on the painted colour an operator sees.
const GRAY_FILL = "bg-[var(--text-muted)]/20";
const RED_FILL = "bg-[var(--danger)]";
const AMBER_FILL = "bg-[var(--amber)]";

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

// A verified D3–D5 scaffold isolates the D6 verdict. A genuine functional
// failure paints red; an infra D6 remains unverified and paints amber.
function greenLadderBelowD6(observedAt: string): StatusRow[] {
  const mk = (key: string, dimension: string): StatusRow => ({
    id: `id-${key}`,
    key,
    dimension,
    state: "green",
    signal: unitPillSignal(key, observedAt),
    observed_at: observedAt,
    transitioned_at: observedAt,
    fail_count: 0,
    first_failure_at: null,
  });
  return [
    mk("e2e:agno/agentic-chat", "e2e"),
    mk("chat:agno", "chat"),
    mk("d5:agno/agentic-chat", "d5"),
  ];
}
const FIXTURE_OBSERVED_AT = "2026-06-19T08:00:00.000Z";

const wired = {
  slug: "agno",
  featureId: "agentic-chat",
  isSupported: true,
  isWired: true,
};

// The captured fixture rows are observed at 2026-06-19T08:00:00Z. The U7
// render proofs are about the INFRA fold (driver-error/abort → gray) and the
// masks-real-red guard — both INDEPENDENT of staleness. Pin `now` to just
// after the rows' `observed_at` so the U8 matrix-staleness fold (which would
// otherwise fold ANY row to gray once it ages past the e2e window relative to
// the wall clock) never confounds the U7 colour under test. The U8 staleness
// behaviour gets its own real-surface proof below.
const FIXTURE_FRESH_NOW = Date.parse("2026-06-19T08:01:00.000Z");

function renderChipForAt(rows: StatusRow[], now?: number): HTMLElement {
  const model = buildCellModel(mapOf(rows), wired, now);
  const { getByTestId } = render(
    <DepthChip
      chipColor={model.chipColor}
      depth={model.achievedDepth}
      status="wired"
      unreachable={model.surfaceState === "unreachable"}
      pending={model.surfaceState === "pending"}
    />,
  );
  return getByTestId("depth-chip");
}

function renderChipFor(rows: StatusRow[]): HTMLElement {
  // Pin to a `now` just after the fixtures' `observed_at` so the U7 colour
  // under test is isolated from the U8 staleness fold (see FIXTURE_FRESH_NOW).
  return renderChipForAt(rows, FIXTURE_FRESH_NOW);
}

function modelFor(rows: StatusRow[], now: number = FIXTURE_FRESH_NOW) {
  return buildCellModel(mapOf(rows), wired, now);
}

// A genuine (non-infra) red D6 row on the SAME cell/instant as the infra
// fixtures, used as the fold's counterfactual: identical placement, but its
// signal carries no infra error class, so WITHOUT the fold it is a product red
// and WITH the fold it stays a product red — i.e. the fold does NOT touch it.
function genuineD6Red(failCount: number): StatusRow {
  return {
    id: "id-genuine-d6",
    key: "d6:agno/agentic-chat",
    dimension: "d6",
    state: "red",
    signal: { slug: "agno", errorClass: "selector-timeout" },
    observed_at: FIXTURE_OBSERVED_AT,
    transitioned_at: FIXTURE_OBSERVED_AT,
    fail_count: failCount,
    first_failure_at: FIXTURE_OBSERVED_AT,
  };
}

// A genuine (non-infra) red D4/chat row, fail_count high enough to clear the
// D4 first-strike de-amplifier (≥2), so a real red D4 rung is a product red —
// the counterfactual for the D4 infra-fold render proof.
function genuineD4Red(failCount: number): StatusRow {
  return {
    id: "id-genuine-d4",
    key: "chat:agno",
    dimension: "chat",
    state: "red",
    signal: { slug: "agno", errorClass: "selector-timeout" },
    observed_at: FIXTURE_OBSERVED_AT,
    transitioned_at: FIXTURE_OBSERVED_AT,
    fail_count: failCount,
    first_failure_at: FIXTURE_OBSERVED_AT,
  };
}

describe("U7 real-surface proof: the infra fold changes the rendered outcome", () => {
  // ── D6-position infra rows ────────────────────────────────────────────
  // Infra D6 errors keep the verified D5 ladder amber and d6Effective null.
  // Genuine functional failures must instead paint red and retain the red badge.
  it("a real per-cell d6 driver-error row folds to d6Effective=null while the chip stays amber (not red)", () => {
    const rows = [
      ...greenLadderBelowD6(FIXTURE_OBSERVED_AT),
      fixture.d6DriverErrorRow as StatusRow,
    ];
    const chip = renderChipFor(rows);
    expect(chip.className).toContain(AMBER_FILL);
    expect(chip.className).not.toContain(RED_FILL);
    // The fold: infra D6 → gray/no-data D6 badge (null), NOT a product red.
    expect(modelFor(rows).d6Effective).toBeNull();
  });

  it("a real abort D6 row folds to d6Effective=null while the chip stays amber (not red)", () => {
    const rows = [
      ...greenLadderBelowD6(FIXTURE_OBSERVED_AT),
      fixture.abortRow as StatusRow,
    ];
    const chip = renderChipFor(rows);
    expect(chip.className).toContain(AMBER_FILL);
    expect(chip.className).not.toContain(RED_FILL);
    expect(modelFor(rows).d6Effective).toBeNull();
  });

  it("masks-real-red guard: a GENUINE D6 red on the SAME intact ladder surfaces d6Effective=red (fold must NOT swallow it)", () => {
    // A genuine D6 failure paints red while infra evidence remains amber.
    const rows = [...greenLadderBelowD6(FIXTURE_OBSERVED_AT), genuineD6Red(1)];
    const chip = renderChipFor(rows);
    expect(chip.className).toContain(RED_FILL);
    expect(chip.className).not.toContain(AMBER_FILL);
    expect(modelFor(rows).d6Effective).toBe("red");
  });

  // ── D4-position infra row: the fold IS visible at the chip surface ──────
  // A D4/chat red is a LOWER rung, not the soft-parity top. On an intact-
  // through-D5 ladder a real red D4 (fail_count ≥ 2, past first-strike) is a
  // product red → chip RED. The infra fold re-classes the D4 rung to no-data,
  // graying the chip. So here the fold flips the RENDERED chip red → gray, a
  // pure render-surface proof.
  it("a real D4 chat driver-error row grays the chip on an intact ladder (WITHOUT the fold it would be product-red)", () => {
    // Overwrite the green chat (D4) rung of the intact ladder with the captured
    // driver-error chat row (errorDesc-only infra class).
    const rows = [
      ...greenLadderBelowD6(FIXTURE_OBSERVED_AT),
      fixture.d4DriverErrorRow as StatusRow,
    ];
    const chip = renderChipFor(rows);
    expect(chip.className).toContain(GRAY_FILL);
    expect(chip.className).not.toContain(RED_FILL);
    expect(chip.className).not.toContain(AMBER_FILL);
  });

  it("teeth: a GENUINE (non-infra) red D4 rung at the SAME position paints the chip RED, not gray", () => {
    // Identical ladder/placement as the D4 infra test, but a non-infra red D4
    // (fail_count 2, past first-strike). WITHOUT the infra fold the driver-error
    // row above would land here — RED. So the infra test's gray assertion has
    // teeth: it fails the instant the fold stops re-classing infra reds.
    const rows = [...greenLadderBelowD6(FIXTURE_OBSERVED_AT), genuineD4Red(2)];
    const chip = renderChipFor(rows);
    expect(chip.className).toContain(RED_FILL);
    expect(chip.className).not.toContain(GRAY_FILL);
  });
});

/**
 * U8 REAL-SURFACE PROOF (spec §7.2 / §6.4).
 *
 * Reuses the SAME genuine `selector-timeout` D6 row the harness persists, on an
 * intact green ladder, rendered at two `now` values — proving the matrix-
 * staleness fold is visible at the render surface: FRESH → the genuine D6
 * failure surfaces RED (d6Effective = red); the SAME rows
 * past the re-sweep window → no-data GRAY ("re-sweep pending", U8 all-stale).
 */
describe("U8 real-surface proof: a fresh D6 failure is red, stale folds to gray", () => {
  // The captured fixture rows are observed at 2026-06-19T08:00:00Z.
  const ROW_OBSERVED_MS = Date.parse("2026-06-19T08:00:00.000Z");
  const FRESH_NOW = ROW_OBSERVED_MS + 60 * 1000; // 1 min later — fresh
  const STALE_NOW = ROW_OBSERVED_MS + E2E_STALE_AFTER_MS + 60 * 60 * 1000; // past window

  it("the real selector-timeout D6 failure surfaces RED while FRESH", () => {
    const chip = renderChipForAt(
      [
        ...greenLadderBelowD6(FIXTURE_OBSERVED_AT),
        fixture.genuineSelectorTimeoutRow as StatusRow,
      ],
      FRESH_NOW,
    );
    expect(chip.className).toContain(RED_FILL);
    expect(chip.className).not.toContain(GRAY_FILL);
  });

  it("the SAME rows paint GRAY once stale past the re-sweep window (U8)", () => {
    const chip = renderChipForAt(
      [
        ...greenLadderBelowD6(FIXTURE_OBSERVED_AT),
        fixture.genuineSelectorTimeoutRow as StatusRow,
      ],
      STALE_NOW,
    );
    expect(chip.className).toContain(GRAY_FILL);
    expect(chip.className).not.toContain(RED_FILL);
  });
});
