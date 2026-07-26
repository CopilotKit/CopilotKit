/**
 * Dashboard cell color / badge / chip / rollup MATRIX.
 *
 * Table-driven verification of input (PocketBase `status` rows) → VISUAL
 * OUTPUT (the colors/badges/chips/rollups an operator actually sees on the
 * Coverage matrix). Distinct from `cell-model.test.ts` (which asserts the
 * `CellModel` intermediate values): this suite asserts the RENDERED
 * representation — TestBadge tone class + glyph, DepthChip CSS class, the
 * `resolveCell` rollup tone, and the column-tally bucketing — so a regression
 * in the model→pixel mapping (e.g. a badge tone class drift, or a chip color
 * class swap) is caught even when the model values are unchanged.
 *
 * EXPECTED values are derived from the AUTHORITATIVE spec
 * "🧮 Showcase Dashboard — Visualization & Rollup Logic"
 * (notion 3733aa38185281d09385ebb7237e89d9, §4–§7), with one explicit,
 * documented divergence: this worktree's HEAD is the per-cell D6 fix
 * (commit c64aebc42), which the spec itself flags as the open question in §3
 * ("the dashboard's resolveD6 was NOT updated to read those per-cell rows" on
 * origin/main). We assert the FIXED per-cell behavior; see the
 * "code-vs-doc divergence" describe block for the explicit delta.
 *
 * Covered:
 *   (1) per-depth single-key pass→green/fail→red/missing→(no badge) for
 *       API(d3)/BE(d4)/1P(d5)/D6, asserted as RENDERED badge tone+glyph.
 *   (2) D6 enum fan-out rollup — beautiful-chat 5-key all-pass/any-fail/
 *       all-missing/partial → documented chip color; the 1:1 + rename
 *       mappings (headless-complete, chat-customization-css, gen-ui-tool-based).
 *   (3) per-cell-vs-aggregate precedence (c64aebc42 fix): resolveD6 reads the
 *       per-cell enum row, the aggregate-only column resolves gray for an
 *       enum-mapped feature.
 *   (4) depth chip D0..D6 × wired/unwired CSS class.
 *   (5) overlay gating: health overlay → badges, depth overlay → chip.
 *   (6) edges: unknown/empty/conflicting/no-mapping.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UnifiedCell } from "../unified-cell";
import type { UnifiedCellProps } from "../unified-cell";
import { DepthChip, chipColorToClass } from "../depth-chip";
import { computeColumnTally } from "../feature-grid";
import type { CellContext } from "../feature-grid";
import type { Integration, Feature, Demo } from "@/lib/registry";
import { buildCellModel } from "@/lib/cell-model";
import type { CellModel, ChipColor, TestStatus } from "@/lib/cell-model";
import { resolveCell, keyFor, CATALOG_TO_D5_KEY } from "@/lib/live-status";
import type {
  LiveStatusMap,
  StatusRow,
  State,
  BadgeTone,
} from "@/lib/live-status";
import { TONE_CLASS } from "../badges";
import type { Overlay } from "@/lib/overlay-types";

// ---------------------------------------------------------------------------
// Reusable fixture builders (test-hygiene: typed, no `as any`, top-level)
// ---------------------------------------------------------------------------

const FRESH = new Date().toISOString();

function row(
  key: string,
  dimension: string,
  state: State,
  overrides: Partial<StatusRow> = {},
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: {},
    observed_at: FRESH,
    transitioned_at: FRESH,
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? FRESH : null,
    ...overrides,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

const SLUG = "agno";

/**
 * Build the live-status rows that hold the D1–D4 gate green for `featureId`,
 * so D5/D6 are the only variables under test. (Gate = e2e green + chat green;
 * see resolveD3/resolveD4.)
 */
function gateGreen(featureId: string): StatusRow[] {
  return [
    row(keyFor("e2e", SLUG, featureId), "e2e", "green"),
    row(keyFor("chat", SLUG), "chat", "green"),
  ];
}

/** Emit one row per mapped D5 sub-key for `featureId`, all the same state. */
function d5Family(featureId: string, state: State): StatusRow[] {
  const keys = CATALOG_TO_D5_KEY[featureId] ?? [];
  return keys.map((k) => row(keyFor("d5", SLUG, k), "d5", state));
}

/** Emit one row per mapped D6 sub-key for `featureId`, all the same state. */
function d6Family(featureId: string, state: State): StatusRow[] {
  const keys = CATALOG_TO_D5_KEY[featureId] ?? [];
  return keys.map((k) => row(keyFor("d6", SLUG, k), "d6", state));
}

function wiredModel(
  live: LiveStatusMap,
  featureId: string,
  now: number = Date.now(),
): CellModel {
  return buildCellModel(
    live,
    { slug: SLUG, featureId, isSupported: true, isWired: true },
    now,
  );
}

// --- Minimal CellContext / props builders for component render --------------

function makeIntegration(): Integration {
  return {
    slug: SLUG,
    name: "Agno",
    demos: [],
  } as unknown as Integration;
}

function makeFeature(featureId: string): Feature {
  return {
    id: featureId,
    name: featureId,
    category: "chat-ui",
    kind: "demo",
  } as unknown as Feature;
}

function makeDemo(featureId: string): Demo {
  return { id: featureId } as unknown as Demo;
}

function makeCtx(live: LiveStatusMap, featureId: string): CellContext {
  return {
    integration: makeIntegration(),
    feature: makeFeature(featureId),
    demo: makeDemo(featureId),
    hostedUrl: "https://example.test/demo",
    shellUrl: "https://example.test",
    liveStatus: live,
    connection: "live",
  };
}

function renderCell(
  live: LiveStatusMap,
  featureId: string,
  overlays: Overlay[],
): ReturnType<typeof render> {
  const model = wiredModel(live, featureId);
  const props: UnifiedCellProps = {
    ctx: makeCtx(live, featureId),
    model,
    overlays: new Set(overlays),
  };
  return render(<UnifiedCell {...props} />);
}

// ---------------------------------------------------------------------------
// Reference tables — the single source of expected mappings.
// ---------------------------------------------------------------------------

/**
 * status → rendered TestBadge tone + glyph (unified-cell.tsx:44-60).
 * `null` status → glyph "?" → Badge returns null (no badge rendered).
 * `undefined` row for `tone` means "no element expected".
 */
const BADGE_RENDER: Record<
  Exclude<TestStatus, null> | "null",
  { tone: BadgeTone; glyph: string }
> = {
  green: { tone: "green", glyph: "✓" },
  red: { tone: "red", glyph: "✗" },
  amber: { tone: "amber", glyph: "~" },
  null: { tone: "gray", glyph: "?" },
};

/** chipColor → CSS class (depth-chip.tsx chipColorToClass, no regression). */
const CHIP_CLASS: Record<ChipColor, string> = {
  green: "bg-emerald-600 text-white",
  amber: "bg-[var(--amber)] text-white",
  red: "bg-[var(--danger)] text-white",
  gray: "bg-[var(--text-muted)]/20 text-[var(--text-muted)]",
};

// ===========================================================================
// (1) Per-depth single-key: pass→green / fail→red / missing→(no badge),
//     asserted as the RENDERED badge tone class + glyph.
// ===========================================================================

describe("(1) per-depth badge rendering — UI/BE/1P/D6", () => {
  // agentic-chat is 1:1 mapped (CATALOG_TO_D5_KEY["agentic-chat"] =
  // ["agentic-chat"]) so each depth is a single key, isolating one badge.
  const FEATURE = "agentic-chat";

  interface DepthCase {
    badge: "UI" | "BE" | "1P" | "D6";
    /** rows that set THIS depth's state; gate rows added automatically. */
    rows: StatusRow[];
    expectStatus: TestStatus;
  }

  // Each case sets the named depth's underlying row(s); for the chip to even
  // reach a given depth the lower rungs must be green, so we layer rows.
  const cases: DepthCase[] = [
    // UI (d3) — single e2e key (legend-correct: D3 is the frontend
    // render — renamed from "E2E (Demo)" to "UI (Frontend)" in the
    // taxonomy cleanup; the underlying probe key stays `e2e:<slug>/<feature>`)
    {
      badge: "UI",
      rows: [row(keyFor("e2e", SLUG, FEATURE), "e2e", "green")],
      expectStatus: "green",
    },
    {
      badge: "UI",
      rows: [row(keyFor("e2e", SLUG, FEATURE), "e2e", "red")],
      expectStatus: "red",
    },
    // BE (d4) — chat/tools; green requires gate green first
    {
      badge: "BE",
      rows: [
        row(keyFor("e2e", SLUG, FEATURE), "e2e", "green"),
        row(keyFor("chat", SLUG), "chat", "green"),
      ],
      expectStatus: "green",
    },
    {
      badge: "BE",
      rows: [
        row(keyFor("e2e", SLUG, FEATURE), "e2e", "green"),
        row(keyFor("chat", SLUG), "chat", "red"),
      ],
      expectStatus: "red",
    },
    // 1P (d5) — single enum key (agentic-chat→agentic-chat)
    {
      badge: "1P",
      rows: [
        ...gateGreen(FEATURE),
        row(keyFor("d5", SLUG, FEATURE), "d5", "green"),
      ],
      expectStatus: "green",
    },
    {
      badge: "1P",
      rows: [
        ...gateGreen(FEATURE),
        row(keyFor("d5", SLUG, FEATURE), "d5", "red"),
      ],
      expectStatus: "red",
    },
    // D6 — single enum key
    {
      badge: "D6",
      rows: [
        ...gateGreen(FEATURE),
        row(keyFor("d5", SLUG, FEATURE), "d5", "green"),
        row(keyFor("d6", SLUG, FEATURE), "d6", "green"),
      ],
      expectStatus: "green",
    },
    {
      badge: "D6",
      rows: [
        ...gateGreen(FEATURE),
        row(keyFor("d5", SLUG, FEATURE), "d5", "green"),
        row(keyFor("d6", SLUG, FEATURE), "d6", "red"),
      ],
      expectStatus: "red",
    },
  ];

  for (const c of cases) {
    it(`${c.badge} ${c.expectStatus} → tone ${BADGE_RENDER[c.expectStatus ?? "null"].tone}, glyph ${BADGE_RENDER[c.expectStatus ?? "null"].glyph}`, () => {
      const live = mapOf(c.rows);
      const { container } = renderCell(live, FEATURE, ["health"]);
      // Find the badge by its leading label text (UI/BE/1P/D6).
      const labels = Array.from(container.querySelectorAll("span")).filter(
        (s) => s.textContent === c.badge,
      );
      expect(labels.length).toBe(1);
      // The glyph sibling carries the tone class.
      const glyphSpan =
        labels[0].parentElement?.querySelector("span.tabular-nums");
      expect(glyphSpan).not.toBeNull();
      const expected = BADGE_RENDER[c.expectStatus ?? "null"];
      expect(glyphSpan?.textContent).toBe(expected.glyph);
      expect(glyphSpan?.className).toContain(TONE_CLASS[expected.tone]);
    });
  }

  it("missing depth → no badge rendered (BE absent when chat/tools missing)", () => {
    // Only e2e present → d4 (BE) does not exist → no BE badge.
    const live = mapOf([row(keyFor("e2e", SLUG, FEATURE), "e2e", "green")]);
    const { container } = renderCell(live, FEATURE, ["health"]);
    const rtLabels = Array.from(container.querySelectorAll("span")).filter(
      (s) => s.textContent === "BE",
    );
    expect(rtLabels.length).toBe(0);
  });

  it("no-data depth (mapped, unemitted) → no badge (glyph '?' → Badge null)", () => {
    // Gate green, D5 mapped but unemitted → d5.status null → 1P glyph "?"
    // → Badge returns null. The 1P badge must NOT render.
    const live = mapOf(gateGreen(FEATURE));
    const model = wiredModel(live, FEATURE);
    expect(model.d5?.exists).toBe(true);
    expect(model.d5?.status).toBeNull();
    const { container } = renderCell(live, FEATURE, ["health"]);
    const cvLabels = Array.from(container.querySelectorAll("span")).filter(
      (s) => s.textContent === "1P",
    );
    expect(cvLabels.length).toBe(0);
  });
});

// ===========================================================================
// (2) D6 enum fan-out rollup — beautiful-chat (5 keys) + rename mappings.
//     Assert the documented chip color (spec §5 chipColor table) per the
//     fan-out family state, AND the actual rendered chip CSS class.
// ===========================================================================

describe("(2) D6 / D5 enum fan-out rollup → chip color", () => {
  const BC = "beautiful-chat"; // 5 sub-keys

  it("beautiful-chat maps to exactly 5 D5/D6 sub-keys (fan-out)", () => {
    expect(CATALOG_TO_D5_KEY[BC]).toEqual([
      "beautiful-chat-toggle-theme",
      "beautiful-chat-pie-chart",
      "beautiful-chat-bar-chart",
      "beautiful-chat-search-flights",
      "beautiful-chat-schedule-meeting",
    ]);
  });

  interface FanCase {
    name: string;
    d5: State | "missing-one" | "absent" | "red-late";
    d6: State | "missing-one" | "absent" | "red-late";
    expectChip: ChipColor;
  }

  // Derived from spec §5 chipColor decision table. Gate is green throughout.
  const fanCases: FanCase[] = [
    // D5 all-green + D6 all-green → green
    {
      name: "D5 all-pass + D6 all-pass",
      d5: "green",
      d6: "green",
      expectChip: "green",
    },
    // D5 all-green + D6 any-fail → amber (D5 green, D6 red)
    {
      name: "D5 all-pass + D6 all-fail",
      d5: "green",
      d6: "red",
      expectChip: "amber",
    },
    // D5 all-green + D6 absent (unemitted) → amber (D5 green, D6 missing)
    {
      name: "D5 all-pass + D6 absent",
      d5: "green",
      d6: "absent",
      expectChip: "amber",
    },
    // D5 all-missing (none emitted) + D6 absent → D5 null → gray
    {
      name: "D5 all-missing + D6 absent",
      d5: "absent",
      d6: "absent",
      expectChip: "gray",
    },
    // D5 partial (1 sub-key missing) + D6 absent → D5 null (strict) → gray
    {
      name: "D5 partial + D6 absent",
      d5: "missing-one",
      d6: "absent",
      expectChip: "gray",
    },
    // D5 any-fail (one red sub-key, RED FIRST) → red (broken ladder dominates D6)
    {
      name: "D5 any-fail (red first)",
      d5: "red",
      d6: "green",
      expectChip: "red",
    },
    // D5 any-fail with the red sub-key NOT first (greens, then a red) →
    // still red. Proves the worst-state fold is order-independent: a red
    // encountered AFTER greens must not be lost. Mirrors the
    // mid-list-red worst-state style in cell-model.test.ts / live-status.test.ts.
    {
      name: "D5 any-fail (red NOT first)",
      d5: "red-late",
      d6: "green",
      expectChip: "red",
    },
  ];

  function buildFanRows(
    kind: State | "missing-one" | "absent" | "red-late",
    dim: "d5" | "d6",
  ): StatusRow[] {
    const keys = CATALOG_TO_D5_KEY[BC] ?? [];
    if (kind === "absent") return [];
    if (kind === "missing-one") {
      // Emit all-but-one green (drop the bar-chart sub-key).
      return keys
        .filter((k) => k !== "beautiful-chat-bar-chart")
        .map((k) => row(keyFor(dim, SLUG, k), dim, "green"));
    }
    if (kind === "red") {
      // One red sub-key, rest green → worst-state red.
      return keys.map((k, i) =>
        row(keyFor(dim, SLUG, k), dim, i === 0 ? "red" : "green"),
      );
    }
    if (kind === "red-late") {
      // Greens first, then a red in a LATER slot (last key) → worst-state
      // must still resolve red regardless of fold order.
      const lastIdx = keys.length - 1;
      return keys.map((k, i) =>
        row(keyFor(dim, SLUG, k), dim, i === lastIdx ? "red" : "green"),
      );
    }
    return keys.map((k) => row(keyFor(dim, SLUG, k), dim, kind));
  }

  for (const c of fanCases) {
    it(`${c.name} → chip ${c.expectChip}`, () => {
      const live = mapOf([
        ...gateGreen(BC),
        ...buildFanRows(c.d5, "d5"),
        ...buildFanRows(c.d6, "d6"),
      ]);
      const model = wiredModel(live, BC);
      expect(model.chipColor).toBe(c.expectChip);

      // Rendered chip CSS class must match the chip color.
      const { getByTestId } = renderCell(live, BC, ["depth"]);
      const chip = getByTestId("depth-chip");
      expect(chip.className).toContain(CHIP_CLASS[c.expectChip]);
    });
  }

  // 1:1 + rename mappings — each resolves through a SINGLE renamed enum key.
  interface RenameCase {
    featureId: string;
    enumKey: string;
  }
  const renameCases: RenameCase[] = [
    { featureId: "headless-complete", enumKey: "gen-ui-headless-complete" },
    { featureId: "chat-customization-css", enumKey: "chat-css" },
    { featureId: "gen-ui-tool-based", enumKey: "gen-ui-custom" },
    { featureId: "agentic-chat", enumKey: "agentic-chat" }, // 1:1 verbatim
  ];

  for (const rc of renameCases) {
    it(`${rc.featureId} maps to enum key '${rc.enumKey}' and greens when that key passes`, () => {
      expect(CATALOG_TO_D5_KEY[rc.featureId]).toEqual([rc.enumKey]);
      // Drive D5+D6 via the RENAMED enum key — proves the fan-out reads the
      // enum key, not the raw catalog featureId.
      const live = mapOf([
        ...gateGreen(rc.featureId),
        row(keyFor("d5", SLUG, rc.enumKey), "d5", "green"),
        row(keyFor("d6", SLUG, rc.enumKey), "d6", "green"),
      ]);
      const model = wiredModel(live, rc.featureId);
      expect(model.d5?.status).toBe("green");
      expect(model.d6?.status).toBe("green");
      expect(model.chipColor).toBe("green");

      // Negative control: a row keyed by the RAW featureId (when it differs
      // from the enum key) must NOT be consulted.
      if (rc.enumKey !== rc.featureId) {
        const rawOnly = mapOf([
          ...gateGreen(rc.featureId),
          row(keyFor("d5", SLUG, rc.featureId), "d5", "green"),
          row(keyFor("d6", SLUG, rc.featureId), "d6", "green"),
        ]);
        const rawModel = wiredModel(rawOnly, rc.featureId);
        // Enum key absent → D5 no-data → gray, NOT green.
        expect(rawModel.d5?.status).toBeNull();
        expect(rawModel.chipColor).toBe("gray");
      }
    });
  }
});

// ===========================================================================
// (3) Per-cell vs aggregate precedence (c64aebc42 fix).
//     resolveD6 reads the per-cell enum row; the aggregate `d6:<slug>` is
//     NOT consulted. An aggregate-only column → gray for an enum-mapped
//     feature.
// ===========================================================================

describe("(3) per-cell D6 vs aggregate precedence (c64aebc42)", () => {
  const FEATURE = "agentic-chat";

  it("green per-cell row wins over a RED aggregate → chip green", () => {
    const live = mapOf([
      ...gateGreen(FEATURE),
      row(keyFor("d5", SLUG, FEATURE), "d5", "green"),
      row(keyFor("d6", SLUG), "d6", "red"), // aggregate red (other cell failed)
      row(keyFor("d6", SLUG, FEATURE), "d6", "green"), // this cell's per-cell row
    ]);
    const model = wiredModel(live, FEATURE);
    expect(model.d6?.status).toBe("green");
    expect(model.d6?.row?.key).toBe("d6:agno/agentic-chat");
    expect(model.chipColor).toBe("green");
  });

  it("aggregate-only (no per-cell row) → D6 no-data → chip gray for enum-mapped feature", () => {
    // Only the aggregate exists; the per-cell enum row is absent. Because
    // resolveD6 reads per-cell keys, D6 resolves to no-data (status null).
    // Here D5 is also unemitted → D5 null + D6 no-data → gray.
    const live = mapOf([
      ...gateGreen(FEATURE),
      row(keyFor("d6", SLUG), "d6", "green"), // aggregate ONLY
    ]);
    const model = wiredModel(live, FEATURE);
    // Aggregate must not be read as the per-cell value.
    expect(model.d6?.status).toBeNull();
    expect(model.d6?.row).toBeNull();
    // D5 unemitted (null) + D6 no-data → gray.
    expect(model.chipColor).toBe("gray");
  });

  it("two features on the same slug resolve INDEPENDENT per-cell D6 rows", () => {
    const live = mapOf([
      ...gateGreen("agentic-chat"),
      row(keyFor("e2e", SLUG, "voice"), "e2e", "green"),
      row(keyFor("chat", SLUG), "chat", "green"),
      row(keyFor("d5", SLUG, "agentic-chat"), "d5", "green"),
      row(keyFor("d5", SLUG, "voice"), "d5", "green"),
      row(keyFor("d6", SLUG), "d6", "red"), // aggregate ignored
      row(keyFor("d6", SLUG, "agentic-chat"), "d6", "green"),
      row(keyFor("d6", SLUG, "voice"), "d6", "red"),
    ]);
    const a = wiredModel(live, "agentic-chat");
    const b = wiredModel(live, "voice");
    expect(a.chipColor).toBe("green");
    expect(b.chipColor).toBe("amber"); // D5 green + D6 red → amber
    expect(a.d6?.row?.key).toBe("d6:agno/agentic-chat");
    expect(b.d6?.row?.key).toBe("d6:agno/voice");
  });

  it("resolveCell D6 badge tone also reads per-cell, not aggregate", () => {
    const live = mapOf([
      ...gateGreen(FEATURE),
      row(keyFor("d6", SLUG), "d6", "red"), // aggregate red
      row(keyFor("d6", SLUG, FEATURE), "d6", "green"), // per-cell green
    ]);
    const cell = resolveCell(live, SLUG, FEATURE);
    expect(cell.d6.tone).toBe("green");
    expect(cell.d6.row?.key).toBe("d6:agno/agentic-chat");
  });
});

// ===========================================================================
// (4) Depth chip D0..D6 × wired/unwired CSS class.
// ===========================================================================

describe("(4) depth chip rendering D0..D6 × wired/unwired", () => {
  // chipColorToClass mapping is the pure contract; assert each color.
  const colors: ChipColor[] = ["green", "amber", "red", "gray"];
  for (const color of colors) {
    it(`chipColorToClass('${color}') → ${CHIP_CLASS[color]}`, () => {
      expect(chipColorToClass(color)).toBe(CHIP_CLASS[color]);
    });
  }

  it("regression always forces danger-red regardless of color", () => {
    for (const color of colors) {
      expect(chipColorToClass(color, true)).toBe(
        "bg-[var(--danger)] text-white",
      );
    }
  });

  // Wired chip renders D{depth} text + data-depth + the chipColor class.
  const depths: Array<0 | 1 | 2 | 3 | 4 | 5 | 6> = [0, 1, 2, 3, 4, 5, 6];
  for (const depth of depths) {
    it(`wired chip depth ${depth} renders "D${depth}" with data-depth`, () => {
      const { getByTestId } = render(
        <DepthChip chipColor="green" depth={depth} status="wired" />,
      );
      const chip = getByTestId("depth-chip");
      expect(chip.textContent).toBe(`D${depth}`);
      expect(chip.getAttribute("data-depth")).toBe(String(depth));
      expect(chip.className).toContain(CHIP_CLASS.green);
    });
  }

  it("unwired (not-wired) cell → gray chip at depth 0", () => {
    const model = buildCellModel(mapOf([]), {
      slug: SLUG,
      featureId: "agentic-chat",
      isSupported: true,
      isWired: false,
    });
    expect(model.chipColor).toBe("gray");
    expect(model.achievedDepth).toBe(0);
    const { getByTestId } = render(
      <DepthChip
        chipColor={model.chipColor}
        depth={model.achievedDepth}
        status="wired"
      />,
    );
    expect(getByTestId("depth-chip").className).toContain(CHIP_CLASS.gray);
  });

  it("unshipped chip renders '--' dashed (not a depth)", () => {
    const { getByTestId } = render(
      <DepthChip chipColor="gray" depth={0} status="unshipped" />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.textContent).toBe("--");
    expect(chip.getAttribute("data-status")).toBe("unshipped");
  });

  it("unsupported chip renders the ban glyph + slate fill", () => {
    const { getByTestId } = render(
      <DepthChip chipColor="gray" depth={0} status="unsupported" />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("data-status")).toBe("unsupported");
    expect(chip.className).toContain("bg-slate-500/10");
  });
});

// ===========================================================================
// (5) Overlay gating — health overlay → badges, depth overlay → chip.
// ===========================================================================

describe("(5) overlay gating: which layers render", () => {
  const FEATURE = "agentic-chat";
  function liveAllGreen(): LiveStatusMap {
    return mapOf([
      ...gateGreen(FEATURE),
      row(keyFor("d5", SLUG, FEATURE), "d5", "green"),
      row(keyFor("d6", SLUG, FEATURE), "d6", "green"),
    ]);
  }

  it("health overlay only → HealthLayer (badges) present, no DepthLayer", () => {
    const { queryByTestId } = renderCell(liveAllGreen(), FEATURE, ["health"]);
    expect(queryByTestId("health-layer")).not.toBeNull();
    expect(queryByTestId("depth-layer")).toBeNull();
  });

  it("depth overlay only → DepthLayer (chip) present, no HealthLayer", () => {
    const { queryByTestId } = renderCell(liveAllGreen(), FEATURE, ["depth"]);
    expect(queryByTestId("depth-layer")).not.toBeNull();
    expect(queryByTestId("health-layer")).toBeNull();
  });

  it("both overlays → both layers render", () => {
    const { queryByTestId } = renderCell(liveAllGreen(), FEATURE, [
      "depth",
      "health",
    ]);
    expect(queryByTestId("depth-layer")).not.toBeNull();
    expect(queryByTestId("health-layer")).not.toBeNull();
  });

  it("no overlays → empty cell (no layers)", () => {
    const { queryByTestId } = renderCell(liveAllGreen(), FEATURE, []);
    expect(queryByTestId("unified-cell-empty")).not.toBeNull();
    expect(queryByTestId("health-layer")).toBeNull();
    expect(queryByTestId("depth-layer")).toBeNull();
  });

  it("unsupported cell short-circuits to ban-icon regardless of overlays", () => {
    const props: UnifiedCellProps = {
      ctx: makeCtx(mapOf([]), FEATURE),
      model: buildCellModel(mapOf([]), {
        slug: SLUG,
        featureId: FEATURE,
        isSupported: false,
        isWired: false,
      }),
      overlays: new Set<Overlay>(["depth", "health"]),
    };
    const { queryByTestId } = render(<UnifiedCell {...props} />);
    expect(queryByTestId("unified-cell-unsupported")).not.toBeNull();
    expect(queryByTestId("health-layer")).toBeNull();
    expect(queryByTestId("depth-layer")).toBeNull();
  });
});

// ===========================================================================
// (6) Edges: empty / conflicting / no-mapping / rollup precedence.
// ===========================================================================

describe("(6) edges + rollup precedence", () => {
  const FEATURE = "agentic-chat";

  it("empty live map → gray chip, no badges, achieved 0", () => {
    const live = mapOf([]);
    const model = wiredModel(live, FEATURE);
    expect(model.chipColor).toBe("gray");
    expect(model.achievedDepth).toBe(0);
    const { queryByTestId } = renderCell(live, FEATURE, ["health", "depth"]);
    // No badges (all levels no-data/missing → all glyph "?" → Badge null).
    // Scope to the HealthLayer — the DepthChip span ALSO carries
    // `tabular-nums`, so a container-wide selector would catch the chip.
    const healthLayer = queryByTestId("health-layer");
    expect(healthLayer).not.toBeNull();
    expect(healthLayer?.querySelectorAll("span.tabular-nums").length).toBe(0);
    expect(queryByTestId("depth-chip")?.className).toContain(CHIP_CLASS.gray);
  });

  it("no-mapping feature (no CATALOG_TO_D5_KEY) → D5/D6 not-exist → gray at D4 ceiling", () => {
    const FEATURE_UNMAPPED = "no-such-d5-feature";
    expect(CATALOG_TO_D5_KEY[FEATURE_UNMAPPED]).toBeUndefined();
    const live = mapOf(gateGreen(FEATURE_UNMAPPED));
    const model = wiredModel(live, FEATURE_UNMAPPED);
    expect(model.d5?.exists).toBe(false);
    expect(model.d6?.exists).toBe(false);
    expect(model.ceilingDepth).toBe(4);
    expect(model.chipColor).toBe("gray");
  });

  it("conflicting D4: green chat + red tools → worst-state red fold, first-strike amber chip", () => {
    const live = mapOf([
      row(keyFor("e2e", SLUG, FEATURE), "e2e", "green"),
      row(keyFor("chat", SLUG), "chat", "green"),
      row(keyFor("tools", SLUG), "tools", "red"),
    ]);
    const model = wiredModel(live, FEATURE);
    // Worst-state wins in the D4 fold — the red tools row beats the green chat.
    expect(model.d4?.status).toBe("red");
    // §C item 6: a first D4 strike (fail_count 1 < 2) de-amplifies to amber;
    // a second consecutive red crosses the threshold → red.
    expect(model.chipColor).toBe("amber");
  });

  it("resolveCell rollup precedence: red > amber(degraded) > green", () => {
    // red wins
    const redLive = mapOf([
      row(keyFor("health", SLUG), "health", "green"),
      row(keyFor("e2e", SLUG, FEATURE), "e2e", "red"),
    ]);
    expect(resolveCell(redLive, SLUG, FEATURE).rollup).toBe("red");

    // degraded → amber when no red
    const amberLive = mapOf([
      row(keyFor("health", SLUG), "health", "degraded"),
      row(keyFor("e2e", SLUG, FEATURE), "e2e", "green"),
    ]);
    expect(resolveCell(amberLive, SLUG, FEATURE).rollup).toBe("amber");

    // all green → green
    const greenLive = mapOf([
      row(keyFor("health", SLUG), "health", "green"),
      row(keyFor("e2e", SLUG, FEATURE), "e2e", "green"),
    ]);
    expect(resolveCell(greenLive, SLUG, FEATURE).rollup).toBe("green");
  });

  it("connection error → rollup forced to error tone (stale-green suppressed)", () => {
    const live = mapOf([
      row(keyFor("health", SLUG), "health", "green"),
      row(keyFor("e2e", SLUG, FEATURE), "e2e", "green"),
    ]);
    const cell = resolveCell(live, SLUG, FEATURE, { connection: "error" });
    // Would-be green becomes error when the stream is down.
    expect(cell.rollup).toBe("error");
  });

  it("column tally buckets by chipColor; gray excluded", () => {
    // Build three features: green, red, gray (no-data) and assert counts.
    const integration = {
      slug: SLUG,
      name: "Agno",
      demos: [{ id: "agentic-chat" }, { id: "voice" }, { id: "subagents" }],
    } as unknown as Integration;
    const features = [
      makeFeature("agentic-chat"), // green
      makeFeature("voice"), // red
      makeFeature("subagents"), // gray (no data)
    ];
    const live = mapOf([
      // agentic-chat full green
      row(keyFor("e2e", SLUG, "agentic-chat"), "e2e", "green"),
      row(keyFor("chat", SLUG), "chat", "green"),
      row(keyFor("d5", SLUG, "agentic-chat"), "d5", "green"),
      row(keyFor("d6", SLUG, "agentic-chat"), "d6", "green"),
      // voice red e2e → red chip
      row(keyFor("e2e", SLUG, "voice"), "e2e", "red"),
      // subagents → no rows → gray (excluded)
    ]);
    const tally = computeColumnTally(integration, features, live, "live");
    expect(tally).toEqual({
      green: 1,
      amber: 0,
      red: 1,
      unknown: false,
      loading: false,
    });
  });

  it("column tally returns unknown=true when connection is error", () => {
    const integration = {
      slug: SLUG,
      name: "Agno",
      demos: [{ id: "agentic-chat" }],
    } as unknown as Integration;
    const tally = computeColumnTally(
      integration,
      [makeFeature("agentic-chat")],
      mapOf([]),
      "error",
    );
    expect(tally).toEqual({
      green: 0,
      amber: 0,
      red: 0,
      unknown: true,
      loading: false,
    });
  });
});

// ===========================================================================
// CODE-VS-DOC DIVERGENCE (reported as a finding, asserted as code behavior).
// ===========================================================================

describe("code-vs-doc divergence — D6 per-cell (spec §3 open question)", () => {
  // The Notion spec (§3, §4 resolveD6) documents origin/main, where resolveD6
  // reads ONLY the integration aggregate `d6:<slug>`. THIS worktree (HEAD
  // c64aebc42) resolves D6 PER-CELL via CATALOG_TO_D5_KEY — the spec's own
  // "open question" resolved. These assertions lock the FIXED behavior and
  // document the delta so the next reader knows the doc trails the code.
  const FEATURE = "agentic-chat";

  it("FIXED behavior: aggregate is NOT the per-cell D6 source (contradicts spec §4 origin/main text)", () => {
    const live = mapOf([
      ...gateGreen(FEATURE),
      row(keyFor("d5", SLUG, FEATURE), "d5", "green"),
      row(keyFor("d6", SLUG), "d6", "red"), // aggregate red
      row(keyFor("d6", SLUG, FEATURE), "d6", "green"), // per-cell green
    ]);
    const model = wiredModel(live, FEATURE);
    // Spec §4 (origin/main) would predict the aggregate red → cell amber/red.
    // FIXED code: per-cell green → chip green.
    expect(model.d6?.row?.key).toBe(keyFor("d6", SLUG, FEATURE));
    expect(model.d6?.row?.key).not.toBe(keyFor("d6", SLUG));
    expect(model.chipColor).toBe("green");
  });
});
