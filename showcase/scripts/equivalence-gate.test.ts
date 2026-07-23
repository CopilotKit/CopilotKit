import { describe, it, expect } from "vitest";
import { runEquivalenceGate } from "./equivalence-gate";
import type { EquivalenceGateInput, GateCell } from "./equivalence-gate";
import type {
  LiveStatusMap,
  StatusRow,
} from "../shell-dashboard/src/lib/live-status";
import { keyFor } from "../shell-dashboard/src/lib/live-status";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-06-19T12:00:00.000Z");
// The re-sweep was triggered 10 minutes before "now" — any prod row observed
// before this instant is pre-trigger (stale for the gate's §6.4 freshness
// rule) and must be excluded.
const RESWEEP_TRIGGER_AT = Date.parse("2026-06-19T11:50:00.000Z");
const FRESH_AT = "2026-06-19T11:55:00.000Z"; // post-trigger
const PRE_TRIGGER_AT = "2026-06-19T11:40:00.000Z"; // before re-sweep trigger

function row(
  dimension: string,
  slug: string,
  featureId: string | undefined,
  state: StatusRow["state"],
  opts: { observedAt?: string; signal?: unknown } = {},
): [string, StatusRow] {
  const key = keyFor(dimension, slug, featureId);
  const observed = opts.observedAt ?? FRESH_AT;
  return [
    key,
    {
      id: `${key}#id`,
      key,
      dimension,
      state,
      signal: opts.signal ?? null,
      observed_at: observed,
      transitioned_at: observed,
      fail_count: state === "red" ? 1 : 0,
      first_failure_at: state === "red" ? observed : null,
    },
  ];
}

/**
 * Build a LiveStatusMap that yields a chosen ChipColor for a single
 * (slug, featureId) cell. We drive `buildCellModel` through the SAME row
 * shapes the dashboard derives from so the gate reuses the real derivation:
 *   - "green": fresh-green D3 e2e + fresh-green chat (D4) + fresh-green d5/d6
 *     for the mapped featureType → ladder intact → green chip.
 *   - "amber": fresh-green e2e + chat + d5 but a fresh-RED d6 → ladder intact
 *     to D5, D6 not green → chip amber (cell-model §"D5 green + D6 red/amber
 *     /missing → amber"). amber is NOT-green, so staging-green/prod-amber is a
 *     gate mismatch.
 *   - "red": fresh-red e2e row → gate fails red.
 *   - "driver-error": red e2e row whose signal carries `errorClass:"driver-error"`
 *     → U7 folds to gray.
 *   - "stale-red": red e2e row observed BEFORE the re-sweep trigger → §6.4
 *     freshness excludes it (gray).
 */
type ColorKind = "green" | "amber" | "red" | "driver-error";

// featureId chosen so it is NOT in CATALOG_TO_D5_KEY → D5/D6 unmapped, so a
// fresh green chat+e2e with a D5-unmapped feature renders... not green (the
// chip needs a mapped green D5 for green). To get a clean green we instead use
// a feature WITH a D5 mapping. Pick a real catalog featureType key.
const MAPPED_FEATURE = "agentic-chat"; // present in CATALOG_TO_D5_KEY

function cellMap(
  slug: string,
  color: ColorKind,
  opts: { observedAt?: string } = {},
): LiveStatusMap {
  const observed = opts.observedAt ?? FRESH_AT;
  const m: LiveStatusMap = new Map();
  if (color === "green" || color === "amber") {
    // Intact ladder up to D5: e2e green, chat green (D4), d5 green for the
    // mapped featureType. D6 decides green vs amber — green for "green", red
    // for "amber" (cell-model: D5 green + D6 not-green → amber chip).
    m.set(
      ...row("e2e", slug, MAPPED_FEATURE, "green", { observedAt: observed }),
    );
    m.set(...row("chat", slug, undefined, "green", { observedAt: observed }));
    m.set(
      ...row("d5", slug, MAPPED_FEATURE, "green", { observedAt: observed }),
    );
    m.set(
      ...row("d6", slug, MAPPED_FEATURE, color === "green" ? "green" : "red", {
        observedAt: observed,
      }),
    );
    return m;
  }
  // red / driver-error: a genuine red e2e row drives the chip red. We still
  // emit a green chat so the D1-D4 gate is exercised (e2e red dominates).
  const signal =
    color === "driver-error" ? { errorClass: "driver-error" } : undefined;
  m.set(
    ...row("e2e", slug, MAPPED_FEATURE, "red", {
      observedAt: observed,
      signal,
    }),
  );
  m.set(...row("chat", slug, undefined, "green", { observedAt: observed }));
  return m;
}

function gateInput(
  cells: GateCell[],
  staging: LiveStatusMap,
  prod: LiveStatusMap,
): EquivalenceGateInput {
  return {
    cells,
    stagingRows: staging,
    prodRows: prod,
    reSweepTriggerAt: RESWEEP_TRIGGER_AT,
    now: NOW,
  };
}

const CELL: GateCell = {
  slug: "demo",
  featureId: MAPPED_FEATURE,
  isSupported: true,
  isWired: true,
};

/** The 4 starter smoke levels, mirroring STARTER_LEVELS. */
const STARTER_LEVELS = ["health", "agent", "chat", "interaction"] as const;

/**
 * A STARTER-axis cell, keyed by its dashboard COLUMN slug. The equivalence
 * gate must resolve its ChipColor from the `starter:<col>/<level>` rows, NOT
 * the agent feature ladder.
 */
const STARTER_CELL: GateCell = {
  slug: "google-adk",
  featureId: "starter",
  isSupported: true,
  isWired: true,
  probeAxis: "starter",
};

/**
 * Build a LiveStatusMap that yields a chosen ChipColor for a starter cell by
 * setting all four `starter:<col>/<level>` rows to a uniform state:
 *   - "green": every level fresh-green → green chip.
 *   - "red":   one level red (the rest green) → red chip.
 */
function starterCellMap(
  columnSlug: string,
  color: "green" | "red",
  opts: { observedAt?: string } = {},
): LiveStatusMap {
  const observed = opts.observedAt ?? FRESH_AT;
  const m: LiveStatusMap = new Map();
  STARTER_LEVELS.forEach((level, i) => {
    const state =
      color === "red" && i === STARTER_LEVELS.length - 1 ? "red" : "green";
    m.set(
      ...row("starter", columnSlug, level, state, { observedAt: observed }),
    );
  });
  return m;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runEquivalenceGate", () => {
  it("FAILS on staging-green / prod-red(genuine)", () => {
    const result = runEquivalenceGate(
      gateInput([CELL], cellMap("demo", "green"), cellMap("demo", "red")),
    );
    expect(result.passed).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      slug: "demo",
      featureId: MAPPED_FEATURE,
      stagingChip: "green",
      prodChip: "red",
    });
    // The mismatch must surface in the summary text for the workflow/Slack.
    expect(result.summary).toContain("demo");
  });

  it("FAILS a STARTER-axis cell green-on-staging / red-on-prod (resolved on the starter-smoke axis)", () => {
    // The starter cell's ChipColor must be derived from `starter:<col>/<level>`
    // rows — NOT the agent e2e/d5/d6 ladder. Staging green + prod red on the
    // starter axis is a real prod regression → gate FAILS.
    const result = runEquivalenceGate(
      gateInput(
        [STARTER_CELL],
        starterCellMap("google-adk", "green"),
        starterCellMap("google-adk", "red"),
      ),
    );
    expect(result.passed).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      slug: "google-adk",
      stagingChip: "green",
      prodChip: "red",
      mismatch: true,
      excluded: false,
    });
  });

  it("EXCLUDES a STARTER-axis cell with a stale prod observation (pre-trigger)", () => {
    // The starter cell's prod rows all predate the re-sweep trigger → §6.4
    // freshness folds the prod chip to gray → excluded → PASS (no false fail).
    const result = runEquivalenceGate(
      gateInput(
        [STARTER_CELL],
        starterCellMap("google-adk", "green"),
        starterCellMap("google-adk", "red", { observedAt: PRE_TRIGGER_AT }),
      ),
    );
    expect(result.passed).toBe(true);
    const cmp = result.comparisons.find((c) => c.slug === "google-adk");
    expect(cmp?.excluded).toBe(true);
    expect(cmp?.excludedReason).toBe("stale-prod");
  });

  it("FAILS on staging-green / prod-amber (amber is not-green → regression)", () => {
    // §6.3: `amber` = not-green. A cell green on staging but amber on prod is a
    // prod regression — the promote degraded a fully-green cell to partial. This
    // exercises the `prodChip !== "green"` mismatch branch via amber (NOT red),
    // so a refactor to "only red is a regression" would be caught here.
    const result = runEquivalenceGate(
      gateInput([CELL], cellMap("demo", "green"), cellMap("demo", "amber")),
    );
    expect(result.passed).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      slug: "demo",
      featureId: MAPPED_FEATURE,
      stagingChip: "green",
      prodChip: "amber",
      mismatch: true,
      excluded: false,
    });
    // The comparison for the cell is recorded as a real, non-excluded mismatch.
    const cmp = result.comparisons.find((c) => c.slug === "demo");
    expect(cmp?.prodChip).toBe("amber");
    expect(cmp?.excluded).toBe(false);
    expect(result.summary).toContain("demo");
  });

  it("PASSES on staging-green / prod-gray(driver-error) — excluded", () => {
    const result = runEquivalenceGate(
      gateInput(
        [CELL],
        cellMap("demo", "green"),
        cellMap("demo", "driver-error"),
      ),
    );
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    // prod folded to gray via U7 → excluded from the gate.
    const cmp = result.comparisons.find((c) => c.slug === "demo");
    expect(cmp?.prodChip).toBe("gray");
    expect(cmp?.excluded).toBe(true);
  });

  it("PASSES when prod is GREENER than staging (one-directional)", () => {
    // staging red, prod green → prod is greener → not a regression → PASS.
    const result = runEquivalenceGate(
      gateInput([CELL], cellMap("demo", "red"), cellMap("demo", "green")),
    );
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it("EXCLUDES a stale prod row (observed before the re-sweep trigger)", () => {
    // staging green, prod red BUT the prod row predates the re-sweep trigger →
    // §6.4 freshness folds it to gray/excluded → PASS.
    const result = runEquivalenceGate(
      gateInput(
        [CELL],
        cellMap("demo", "green"),
        cellMap("demo", "red", { observedAt: PRE_TRIGGER_AT }),
      ),
    );
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    const cmp = result.comparisons.find((c) => c.slug === "demo");
    expect(cmp?.excluded).toBe(true);
    expect(cmp?.excludedReason).toBe("stale-prod");
  });

  it("PASSES when both sides are green (equivalent)", () => {
    const result = runEquivalenceGate(
      gateInput([CELL], cellMap("demo", "green"), cellMap("demo", "green")),
    );
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it("EXCLUDES a cell that is gray on STAGING (no staging-green claim to honor)", () => {
    // staging driver-error→gray, prod red. Gate fires ONLY on staging-green, so
    // a gray-staging cell is excluded regardless of prod.
    const result = runEquivalenceGate(
      gateInput(
        [CELL],
        cellMap("demo", "driver-error"),
        cellMap("demo", "red"),
      ),
    );
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    const cmp = result.comparisons.find((c) => c.slug === "demo");
    expect(cmp?.excluded).toBe(true);
  });

  it("reports every cell in comparisons and aggregates multiple mismatches", () => {
    const cellA: GateCell = { ...CELL, slug: "a" };
    const cellB: GateCell = { ...CELL, slug: "b" };
    const staging: LiveStatusMap = new Map([
      ...cellMap("a", "green"),
      ...cellMap("b", "green"),
    ]);
    const prod: LiveStatusMap = new Map([
      ...cellMap("a", "red"),
      ...cellMap("b", "green"),
    ]);
    const result = runEquivalenceGate(gateInput([cellA, cellB], staging, prod));
    expect(result.passed).toBe(false);
    expect(result.comparisons).toHaveLength(2);
    expect(result.mismatches.map((m) => m.slug)).toEqual(["a"]);
  });
});
