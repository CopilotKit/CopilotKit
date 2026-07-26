/**
 * Single-source-of-truth guarantee test (spec §6.1 guarantee 1, plan T16).
 *
 * `deriveDepth` (dashboard) is now a thin adapter over `buildCellModel` (the
 * one engine): it does nothing but call
 * `buildCellModel(live, catalogCellToInput(cell), now)` and project four
 * fields off the result (see `components/depth-utils.ts`). This test PINS
 * that relationship over the entire committed golden matrix
 * (`cell-model.equivalence-fixtures.ts`, spec §6) so the two ladders can never
 * silently drift apart again: if a future change re-introduces an
 * independent code path inside `deriveDepth` (an extra staleness override, a
 * different field mapping, a forgotten `now`, ...), this test fails on the
 * first fixture where the two diverge.
 *
 * Because the redesign already collapsed `deriveDepth` to exactly this
 * formula, every case here holds BY CONSTRUCTION today — that is the point:
 * the test is the guardrail, not a value assertion about the engine itself
 * (the engine's own values are pinned separately by
 * `cell-model.equivalence.test.ts`).
 * See the PR body / agent report for the mutation-testing proof that this
 * guardrail has teeth (a deliberately-broken `deriveDepth` was run against
 * this suite and observed RED before being reverted to GREEN).
 *
 * A second guarantee (spec §6.2 — per-leg symmetry) is pinned below: the
 * fixture matrix itself must exercise every variant (red-fresh, stale-green,
 * degraded, absent, future-skew-green, red-infra, red-signal-unknown) on
 * EVERY rung position (D3/D4/D5/D6) — a guard that lands on one leg but not
 * its siblings would silently ship an under-tested leg.
 */
import { describe, it, expect } from "vitest";
import { deriveDepth } from "@/components/depth-utils";
import type { CatalogCell } from "@/data/catalog-types";
import { buildCellModel, catalogCellToInput } from "@/lib/cell-model";
import type { CellModelInput } from "@/lib/cell-model";
// Reused directly from the harness golden matrix (spec §6) — the read-only
// import this task is scoped to. Never re-derive a second fixture set here.
import {
  FIXTURES,
  NOW,
} from "../../../../harness/src/shared/cell-model/cell-model.equivalence-fixtures";

/**
 * Reconstruct a `CatalogCell` whose STRUCTURAL axes round-trip through
 * `catalogCellToInput` back to the fixture's `CellModelInput` (modulo the
 * `probeAxis` default, which `catalogCellToInput` always makes explicit —
 * see the round-trip assertion below). This lets the golden matrix — written
 * natively in engine-input terms — drive the dashboard adapter without a
 * second, hand-maintained fixture set.
 */
function inputToCell(input: CellModelInput): CatalogCell {
  const manifestation: CatalogCell["manifestation"] =
    input.probeAxis === "starter" ? "starter" : "integrated";
  const status: CatalogCell["status"] = !input.isSupported
    ? "unsupported"
    : input.isWired
      ? "wired"
      : "unshipped";
  return {
    id: `${input.slug}/${input.featureId ?? "null"}`,
    manifestation,
    integration: input.slug,
    integration_name: input.slug,
    feature: input.featureId,
    feature_name: input.featureId,
    status,
    parity_tier: "at_parity",
    max_depth: 6,
    category: "dev-ex",
    category_name: "Dev Ex",
  };
}

describe("ladder-single-source: deriveDepth is a pure projection of buildCellModel (spec §6.1)", () => {
  it("exercises a non-trivial golden matrix (sanity on the import itself)", () => {
    // Guards against an accidental empty/truncated import silently making
    // every fixture-driven `it` below vacuous.
    expect(FIXTURES.length).toBeGreaterThan(50);
  });

  for (const fixture of FIXTURES) {
    it(`"${fixture.name}": catalogCellToInput round-trips the fixture's engine input`, () => {
      const cell = inputToCell(fixture.input);
      const roundTripped = catalogCellToInput(cell);
      // `probeAxis` is optional on the fixture's raw `CellModelInput` (omitted
      // means "agent") but `catalogCellToInput` always emits it explicitly —
      // normalize before comparing so the round-trip check reflects the
      // ENGINE-meaningful default, not an incidental optional-field wrinkle.
      expect(roundTripped).toEqual({
        ...fixture.input,
        probeAxis: fixture.input.probeAxis ?? "agent",
      });
    });

    it(`"${fixture.name}": deriveDepth(cell, live, now) equals the buildCellModel projection`, () => {
      const cell = inputToCell(fixture.input);
      const model = buildCellModel(fixture.live, catalogCellToInput(cell), NOW);
      const expected = {
        achieved: model.achievedDepth,
        maxPossible: model.ceilingDepth,
        isRegression: model.isRegression,
        unsupported: !model.supported,
      };
      // Sanity: the projection must be a *specific* concrete value, not a
      // vacuously-passing default — otherwise a fixture that never exercises
      // the adapter would still pass. Every agent-axis fixture reaches a real
      // depth or is flagged unsupported; the starter axis legitimately stays
      // at achieved=ceiling=0 throughout (spec §4g — starter never advances
      // on the D0-D6 ladder, its verdict lives in the chip, not the depth).
      expect(
        cell.manifestation === "starter" ||
          expected.unsupported ||
          expected.achieved > 0 ||
          expected.maxPossible > 0,
      ).toBe(true);

      expect(deriveDepth(cell, fixture.live, NOW)).toEqual(expected);
    });
  }
});

describe("fixture matrix per-leg symmetry (spec §6.2 guarantee 2)", () => {
  const RUNG_POSITIONS = ["d3", "d4", "d5", "d6"] as const;
  // D4-only variants are legitimately D4-specific (spec §C item 6 — the D4
  // first-strike de-amplifier does not apply to D3/D5/D6, which have
  // first-strike disabled by `firstStrikeConfig`). Every OTHER variant must
  // land on all four positions.
  const POSITION_SPECIFIC_SUFFIXES = new Set([
    "d4-firststrike-fc1",
    "d4-firststrike-fc2",
  ]);

  const posFixtureRe = /^pos-(d3|d4|d5|d6)-(.+)$/;
  const positionsBySuffix = new Map<string, Set<string>>();
  for (const fixture of FIXTURES) {
    const match = posFixtureRe.exec(fixture.name);
    if (!match) continue;
    const [, pos, suffix] = match;
    if (!positionsBySuffix.has(suffix))
      positionsBySuffix.set(suffix, new Set());
    positionsBySuffix.get(suffix)!.add(pos);
  }

  it("found at least one position-swept variant to check (sanity)", () => {
    expect(positionsBySuffix.size).toBeGreaterThan(0);
  });

  for (const [suffix, positions] of positionsBySuffix) {
    const isPositionSpecific = POSITION_SPECIFIC_SUFFIXES.has(suffix);
    it(`variant "${suffix}" is exercised ${isPositionSpecific ? "only on D4 (position-specific)" : "on every rung position D3/D4/D5/D6"}`, () => {
      if (isPositionSpecific) {
        expect([...positions].sort()).toEqual(["d4"]);
      } else {
        expect([...positions].sort()).toEqual([...RUNG_POSITIONS]);
      }
    });
  }
});
