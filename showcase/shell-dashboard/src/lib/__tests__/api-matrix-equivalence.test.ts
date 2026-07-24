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
import { buildCellModel } from "../../../../harness/src/shared/cell-model/cell-model";
import type {
  CellModel,
  CellModelInput,
} from "../../../../harness/src/shared/cell-model/cell-model";
import { catalogCellToInput } from "../../../../harness/src/shared/cell-model/catalog-input";
import {
  keyFor,
  mergeRowsToMap,
} from "../../../../harness/src/shared/cell-model/live-status";
import type {
  StatusRow,
  State,
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

// ── FAIL-SAFE POLARITY (§11.4). The server always supplies the full `signal`;
//    the browser's bulk fetch STRIPS it. For a genuine product-red rung, BOTH
//    reads must now answer RED: absence of evidence about WHY a rung failed must
//    not erase the FACT that it failed.
//
//    This block previously asserted `coldLoadChip === "gray"` and called that
//    "the more accurate answer" — it pinned the defect as intended behaviour,
//    which is precisely why CI never caught it. A stripped `signal` is a PENDING
//    attribution (on the pinned PocketBase 0.22.21 the key is omitted ONLY under
//    a `fields=` projection; a genuinely signal-less row arrives as `null` — see
//    the version qualifier and upgrade hazard in `STATUS_LIST_FIELDS`' doc), so
//    graying on it traded ~94% of real reds away to suppress ~6% infra false
//    alarms — and it did so for up to a full probe period, ~60 min for the hourly
//    `e2e:`/`starter:`/`d6:` writers (cadences in
//    `harness/config/probes/*.yml`), on every page load. The 94/6 figures are a
//    2026-07-24 production snapshot (336 vs 21 of 357 red rows); the query and
//    its caveats live at the fail-safe-polarity note in
//    `cell-model.contribution.ts`. The assertion is inverted here DELIBERATELY:
//    the safe direction for a health dashboard is over-reporting failure, never
//    hiding it. ──────────────────────────────────────────────────────────────
describe("fail-safe polarity — a stripped `signal` never grays a real red (§11.4)", () => {
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

  it("full signal → RED (server / api); stripped signal (browser cold-load) → RED too", () => {
    // Server / API state: full `signal` on every row (so the red-row-scoped
    // `fold.redSignalKnown` is true).
    const fullSignal = mergeRowsToMap([
      row(e2eKey, "red", { errorDesc: "assertion failed: wrong answer" }),
      row(chatKey, "green", null),
      row(toolsKey, "green", null),
    ]);
    // Browser cold-load state: the bulk initial fetch PROJECTS `signal` away
    // (signal === undefined → `fold.redSignalKnown` false) on the red rung.
    const stripped = mergeRowsToMap([
      row(e2eKey, "red", undefined),
      row(chatKey, "green", undefined),
      row(toolsKey, "green", undefined),
    ]);

    const serverChip = buildCellModel(fullSignal, input, NOW).chipColor;
    const coldLoadChip = buildCellModel(stripped, input, NOW).chipColor;

    // The classifier still cannot tell an infra red from a product red without
    // `signal` — but "can't tell" now fails toward RED, not toward gray.
    // Graying a red requires POSITIVE infra evidence on every contributing red
    // row (see `classifyRung`), and a stripped blob is the ABSENCE of evidence.
    expect(serverChip).toBe("red");
    expect(coldLoadChip).toBe("red");
    // No chip divergence between the server read and the browser cold-load
    // read. This equality is the guard: if the projection (or the supplemental
    // signal fetch that repairs it) ever regresses again, the browser must
    // OVER-report the failure, never silently drop it.
    expect(coldLoadChip).toBe(serverChip);

    // /api/matrix always runs on the full-signal input, so it reports the TRUE
    // chip (red) — and the browser now agrees from first paint.
    const apiChip = computeMatrix(fullSignal, [cell], NOW)[0]!.chipColor;
    expect(apiChip).toBe("red");
    expect(apiChip).toBe(serverChip);
  });

  // The block above pins the cold-load equality on a SINGLE-KEY D3 family
  // (`e2e:<slug>/<feature>`), where the family's only row IS the red row — so a
  // family-scoped and a red-row-scoped "was `signal` delivered?" precondition
  // coincide and the distinction is invisible.
  //
  // MULTI-ROW families are where they diverge, and they are the common case: D4
  // is `chat:<slug>` + `tools:<slug>`, and a multi-pill D5/D6 is one
  // `<dim>:<slug>/<pill>` row per pill. The supplemental signal fetch restores
  // `signal` for `state != "green"` ONLY, so in a mixed-state family the red
  // rows arrive WITH attribution and the green siblings arrive WITHOUT it. A
  // family-scoped precondition then reads "not delivered" because of a row the
  // infra branch never looks at, the U7 gray is skipped, and the browser paints
  // RED a cell that `/api/matrix` (full `signal`, always) reports as gray.
  it("multi-row D4 family: an infra red beside a projected-away GREEN sibling does not drift api-vs-browser", () => {
    // `tools` is the infra red; `chat` is green, so the supplemental fetch
    // skips it and its `signal` stays stripped on a cold load.
    const serverRows = [
      row(e2eKey, "green", null),
      row(chatKey, "green", null),
      row(toolsKey, "red", { errorClass: "driver-error" }),
    ];
    const fullSignal = mergeRowsToMap(serverRows);
    const stripped = mergeRowsToMap(
      serverRows.map((r) =>
        r.state === "green" ? { ...r, signal: undefined } : r,
      ),
    );

    const serverChip = buildCellModel(fullSignal, input, NOW).chipColor;
    const coldLoadChip = buildCellModel(stripped, input, NOW).chipColor;
    const apiChip = computeMatrix(fullSignal, [cell], NOW)[0]!.chipColor;

    // Every contributing RED row is positively infra-attributed → gray.
    expect(serverChip).toBe("gray");
    // The SAME rows read through the browser's cold-load projection. Pre-fix
    // this was "red" — a real api-vs-render drift on the most common family
    // shape on the board.
    expect(coldLoadChip).toBe("gray");
    expect(coldLoadChip).toBe(serverChip);
    expect(apiChip).toBe(serverChip);
  });

  it("an INFRA red still grays — the gray path requires POSITIVE evidence", () => {
    // Negative control for the polarity flip: when the `signal` blob IS present
    // and positively attributes every red to an INFRA error class, the rung
    // still classifies INFRA_RED_FRESH → gray. The flip widens RED only for the
    // can't-tell case; it does not collapse the infra distinction itself.
    const infraSignal = mergeRowsToMap([
      row(e2eKey, "red", { errorClass: "driver-error" }),
      row(chatKey, "green", null),
      row(toolsKey, "green", null),
    ]);
    expect(buildCellModel(infraSignal, input, NOW).chipColor).toBe("gray");
  });
});
