/**
 * `api == render == adapter` — the drift-guard for the §11 read-model.
 *
 * The whole ladder redesign exists because the chip color diverged across two
 * ladder derivations. §11 exposes that same engine as `GET /api/matrix`. This
 * test pins, over the SAME §6 golden fixture matrix, that all three surfaces
 * agree per cell:
 *
 *   computeMatrix(rows, [cell], now)[0]     // the §11 endpoint's per-cell projection
 *     == buildCellModel(rows, input, now)   // the render's engine (§2)
 *     == deriveDepth(cell, rows, now)       // the post-collapse dashboard adapter (§5)
 *
 * They agree by construction (all funnel through the ONE `catalogCellToInput` →
 * `buildCellModel`), so this test would only go RED if some path re-derived
 * independently — which is exactly what it prevents.
 *
 * IMPORTANT (finding 3): this three-way test references the dashboard's
 * `deriveDepth`, so it MUST live dashboard-side — the harness must never import
 * the dashboard. It imports the endpoint's PURE `computeMatrix` and the engine
 * DIRECTLY from the harness package (NOT via the `@/lib/cell-model` barrel — the
 * barrel is engine-owned), the allowed dashboard→harness direction.
 */
import { describe, it, expect } from "vitest";
import { deriveDepth } from "@/components/depth-utils";
import type { CatalogCell } from "@/data/catalog-types";
import {
  buildCellModel,
  type CellModel,
  type CellModelInput,
} from "../../../../harness/src/shared/cell-model/cell-model";
import { catalogCellToInput } from "../../../../harness/src/shared/cell-model/catalog-input";
import {
  keyFor,
  mergeRowsToMap,
  type StatusRow,
  type State,
} from "../../../../harness/src/shared/cell-model/live-status";
import {
  FIXTURES,
  NOW,
} from "../../../../harness/src/shared/cell-model/cell-model.equivalence-fixtures";
import { computeMatrix } from "../../../../harness/src/http/matrix-compute";

/** The shared projection all three surfaces expose. */
interface Proj {
  achieved: number;
  maxPossible: number;
  isRegression: boolean;
  unsupported: boolean;
}

function projOfModel(m: CellModel): Proj {
  return {
    achieved: m.achievedDepth,
    maxPossible: m.ceilingDepth,
    isRegression: m.isRegression,
    unsupported: !m.supported,
  };
}

/**
 * Invert `catalogCellToInput` (§5a): reconstruct the structural catalog cell
 * whose mapping reproduces a fixture's `CellModelInput`, so the render input
 * (`fixture.input`), the adapter (`deriveDepth(cell, …)`), and the endpoint
 * (`computeMatrix([cell], …)`) all resolve to the SAME engine input.
 *   status: !isSupported → "unsupported"; isWired → "wired"; else "unshipped".
 * `parity_tier`/names/`max_depth` are not read by the engine — filled for the
 * dashboard `CatalogCell` shape only.
 */
function fixtureToCell(input: CellModelInput): CatalogCell {
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
    category: null,
    category_name: null,
    status,
    parity_tier: "at_parity",
    max_depth: status === "unshipped" || status === "unsupported" ? 0 : 4,
  };
}

describe("api == render == adapter over the golden fixture matrix (§11.4)", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const cell = fixtureToCell(fixture.input);

      // Guard the inverse: the reconstructed cell maps back to the SAME engine
      // input the fixture renders with (probeAxis "agent" ≡ undefined default).
      const mapped = catalogCellToInput(cell);
      expect({ ...mapped, probeAxis: mapped.probeAxis ?? "agent" }).toEqual({
        ...fixture.input,
        probeAxis: fixture.input.probeAxis ?? "agent",
      });

      // 1) render engine (§2)
      const model = buildCellModel(fixture.live, fixture.input, NOW);
      const renderProj = projOfModel(model);

      // 2) §11 endpoint per-cell projection
      const apiCell = computeMatrix(fixture.live, [cell], NOW)[0]!;
      const apiProj: Proj = {
        achieved: apiCell.achievedDepth,
        maxPossible: apiCell.ceilingDepth,
        isRegression: apiCell.isRegression,
        unsupported: !apiCell.supported,
      };

      // 3) dashboard adapter (§5)
      const adapterProj = deriveDepth(cell, fixture.live, NOW);

      expect(apiProj).toEqual(renderProj);
      expect(adapterProj).toEqual(renderProj);

      // The API also carries the full chip color / surface state — pin those
      // against the render too (the chip the API reports IS the rendered chip).
      expect(apiCell.chipColor).toBe(model.chipColor);
      expect(apiCell.d6Effective).toBe(model.d6Effective);
      expect(apiCell.surfaceState).toBe(model.surfaceState);
      expect(apiCell.isStaleCell).toBe(model.isStaleCell);
    });
  }
});

// ── MANDATORY red-green: the ONE intended input difference (§11.4). The server
//    always supplies the full `signal`; the browser cold-load STRIPS it. For a
//    genuine product-red rung, the full-signal answer is RED (the true chip),
//    while the stripped-signal cold-load paint is GRAY (§3 rule 4 safe
//    fallback). /api/matrix (full signal) reports the true, more-accurate chip;
//    a naive stripped-signal read would MISreport it. ────────────────────────
describe("full-signal advantage — /api/matrix is the more accurate answer (§11.4)", () => {
  const SLUG = "acme";
  const FEATURE = "agentic-chat";
  const FRESH = new Date(NOW - 60_000).toISOString();

  function row(key: string, state: State, signal: unknown): StatusRow {
    const [dimension = ""] = key.split(":");
    const isRed = state === "red";
    return {
      id: `id-${key}`,
      key,
      dimension,
      state,
      signal,
      observed_at: FRESH,
      transitioned_at: FRESH,
      fail_count: isRed ? 2 : 0, // ≥ D4/starter first-strike threshold → hard red
      first_failure_at: isRed ? FRESH : null,
    };
  }

  const cell = fixtureToCell({
    slug: SLUG,
    featureId: FEATURE,
    isSupported: true,
    isWired: true,
  });
  const input = catalogCellToInput(cell);

  // A genuine PRODUCT red on D3 (signal present, NO infra errorClass).
  const e2eKey = keyFor("e2e", SLUG, FEATURE);
  const chatKey = keyFor("chat", SLUG);
  const toolsKey = keyFor("tools", SLUG);

  it("full signal → RED (server / api); stripped signal (browser cold-load) → gray", () => {
    // Server / API state: full `signal` on every row (signalKnown === true).
    const fullSignal = mergeRowsToMap([
      row(e2eKey, "red", { errorDesc: "assertion failed: wrong answer" }),
      row(chatKey, "green", null),
      row(toolsKey, "green", null),
    ]);
    // Browser cold-load state: the bulk initial fetch PROJECTS `signal` away
    // (signal === undefined → signalKnown === false) on the red rung.
    const stripped = mergeRowsToMap([
      row(e2eKey, "red", undefined),
      row(chatKey, "green", undefined),
      row(toolsKey, "green", undefined),
    ]);

    const serverChip = buildCellModel(fullSignal, input, NOW).chipColor;
    const coldLoadChip = buildCellModel(stripped, input, NOW).chipColor;

    // RED-GREEN: the two inputs diverge — the classifier CANNOT tell an infra
    // red from a product red without `signal`, so it fails safe to gray.
    expect(serverChip).toBe("red");
    expect(coldLoadChip).toBe("gray");
    expect(serverChip).not.toBe(coldLoadChip);

    // /api/matrix always runs on the full-signal input, so it reports the
    // TRUE chip (red) — the state the browser converges to after its
    // supplemental `signal` fetch (§7 I5), i.e. the more accurate answer.
    const apiChip = computeMatrix(fullSignal, [cell], NOW)[0]!.chipColor;
    expect(apiChip).toBe("red");
    expect(apiChip).toBe(serverChip);
  });
});
