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

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

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

describe("U7 real-surface proof: driver-error/abort rows render gray", () => {
  it("a real per-cell d6 driver-error row (errorClass) paints GRAY, not red", () => {
    const chip = renderChipFor([fixture.d6DriverErrorRow as StatusRow]);
    expect(chip.className).toContain(GRAY_FILL);
    expect(chip.className).not.toContain(RED_FILL);
  });

  it("a real D4 chat driver-error row (errorDesc only) paints GRAY, not red", () => {
    const chip = renderChipFor([fixture.d4DriverErrorRow as StatusRow]);
    expect(chip.className).toContain(GRAY_FILL);
    expect(chip.className).not.toContain(RED_FILL);
  });

  it("a real abort row paints GRAY, not red", () => {
    const chip = renderChipFor([fixture.abortRow as StatusRow]);
    expect(chip.className).toContain(GRAY_FILL);
    expect(chip.className).not.toContain(RED_FILL);
  });

  it("a genuine selector-timeout assertion failure STILL paints RED (masks-real-red guard)", () => {
    const chip = renderChipFor([
      fixture.genuineSelectorTimeoutRow as StatusRow,
    ]);
    expect(chip.className).toContain(RED_FILL);
    expect(chip.className).not.toContain(GRAY_FILL);
  });
});

/**
 * U8 REAL-SURFACE PROOF (spec §7.2 / §6.4).
 *
 * Reuses the SAME genuine `selector-timeout` row the harness persists — a real
 * ran-and-failed assertion that U7 deliberately keeps RED. The two assertions
 * below render that one real row through `buildCellModel` → `DepthChip` at two
 * different `now` values, proving the matrix-staleness fold is visible at the
 * render surface (not just in a unit return value): FRESH → danger RED; the
 * same row past the e2e re-sweep window → no-data GRAY ("re-sweep pending").
 */
describe("U8 real-surface proof: a stale red row renders gray", () => {
  // The captured fixture rows are observed at 2026-06-19T08:00:00Z.
  const ROW_OBSERVED_MS = Date.parse("2026-06-19T08:00:00.000Z");
  const FRESH_NOW = ROW_OBSERVED_MS + 60 * 1000; // 1 min later — fresh
  const STALE_NOW = ROW_OBSERVED_MS + E2E_STALE_AFTER_MS + 60 * 60 * 1000; // past window

  it("the real selector-timeout row paints RED while FRESH", () => {
    const chip = renderChipForAt(
      [fixture.genuineSelectorTimeoutRow as StatusRow],
      FRESH_NOW,
    );
    expect(chip.className).toContain(RED_FILL);
    expect(chip.className).not.toContain(GRAY_FILL);
  });

  it("the SAME row paints GRAY once stale past the re-sweep window (U8)", () => {
    const chip = renderChipForAt(
      [fixture.genuineSelectorTimeoutRow as StatusRow],
      STALE_NOW,
    );
    expect(chip.className).toContain(GRAY_FILL);
    expect(chip.className).not.toContain(RED_FILL);
  });
});
