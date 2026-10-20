/**
 * Phase 1d RENDER gate — the starter block draws ONE cell per column.
 *
 * The engine side of this ladder is already gated upstream
 * (`starter-ladder.redgreen.test.ts`, `starter-rung-contract.test.ts`). What
 * those cannot see is the RENDER: `combine()` can fold a correct `D1` and the
 * cell can still paint a green `✓` on the gated rung, print `S1` where the
 * approved visual says `D1`, or wear a `/3` denominator. Every case below was
 * observed RED against a stated mutation of `starter-cell.tsx` — the mutation
 * is named in the case's own comment, and none of them is a mutation of the
 * test's fixture.
 *
 * The models are built by the REAL `buildCellModel` over a synthesized
 * `LiveStatusMap`, never hand-assembled, so a case cannot pass by asserting
 * against a shape the engine does not actually produce.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildCellModel } from "@/lib/cell-model";
import type { CellModelInput } from "@/lib/cell-model";
import { keyFor, mergeRowsToMap } from "@/lib/live-status";
import type { State, StatusRow } from "@/lib/live-status";
import { GLYPHS } from "@/lib/glyphs";
import {
  StarterCell,
  starterCellTooltip,
  rungPrefix,
} from "@/components/starter-cell";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const COL = "langgraph-python";

const row = (level: string, state: State): StatusRow => ({
  id: `id-${level}`,
  key: keyFor("starter", COL, level),
  dimension: "starter",
  state,
  signal: state === "red" ? { errorClass: "assertion-failed" } : null,
  observed_at: FRESH,
  transitioned_at: FRESH,
  fail_count: state === "red" ? 2441 : 0,
  first_failure_at: state === "red" ? "2026-06-04T09:40:02.000Z" : null,
});

const INPUT: CellModelInput = {
  slug: COL,
  featureId: "starter",
  isSupported: true,
  isWired: true,
  probeAxis: "starter",
};

/** The langgraph trio's verified staging shape: shell green, runtime red. */
const trio = () =>
  buildCellModel(
    mergeRowsToMap([
      row("shell", "green"),
      row("runtime", "red"),
      row("agentrun", "green"),
    ]),
    INPUT,
    NOW,
  );

/** All three rungs green — the seven columns that reach the ceiling. */
const full = () =>
  buildCellModel(
    mergeRowsToMap([
      row("shell", "green"),
      row("runtime", "green"),
      row("agentrun", "green"),
    ]),
    INPUT,
    NOW,
  );

/** Supported, provisioned, but not one rung has ever reported. */
const neverReported = () => buildCellModel(mergeRowsToMap([]), INPUT, NOW);

const unsupported = () =>
  buildCellModel(mergeRowsToMap([]), { ...INPUT, isSupported: false }, NOW);

describe("StarterCell — the depth chip", () => {
  // MUTATION THAT REDS THIS: in `StarterCell`, give the chip an explicit
  // label instead of letting `DepthChip` print `D{depth}` — e.g. render
  // `<StatusChip label={`S${model.achievedDepth}/${model.ceilingDepth}`} …>`
  // in place of `<DepthChip …>`. The chip then reads `S1/3` and all three
  // assertions below fail.
  it("reads D<n> — no S prefix, no /3 denominator", () => {
    render(<StarterCell slug={COL} model={trio()} />);
    const chip = screen.getByTestId("depth-chip");
    expect(chip.textContent).toBe("D1");
    expect(chip.textContent).not.toMatch(/\/\s*\d/);
    expect(chip.textContent).not.toMatch(/^S/);
  });

  it("a full ladder reads D3, still with no denominator", () => {
    render(<StarterCell slug={COL} model={full()} />);
    expect(screen.getByTestId("depth-chip").textContent).toBe("D3");
  });
});

describe("StarterCell — the rung strip", () => {
  // MUTATION THAT REDS THIS: change `rungPrefix` to `return rung.kind` — the
  // internal `S1`/`S2`/`S3` keys. The strip then reads `S1 ✓ S2 ✗ S3 —`.
  it("prefixes rungs D1/D2/D3 while the internal KINDS stay S1/S2/S3", () => {
    const model = trio();
    expect((model.ladderRungs ?? []).map((r) => r.kind)).toEqual([
      "S1",
      "S2",
      "S3",
    ]);
    expect((model.ladderRungs ?? []).map(rungPrefix)).toEqual([
      "D1",
      "D2",
      "D3",
    ]);

    render(<StarterCell slug={COL} model={model} />);
    const strip = screen.getByTestId(`starter-rungs-${COL}`);
    expect(strip.textContent).toBe(
      `D1 ${GLYPHS.pass.mark}D2 ${GLYPHS.fail.mark}D3 ${GLYPHS.gated.mark}`,
    );
  });

  // MUTATION THAT REDS THIS: in `RUNG_GLYPH`, map `gated` to
  // `{ mark: GLYPHS.pass.mark, tone: "green" }` — i.e. credit a rung the
  // engine explicitly declined to credit. The strip then paints `D3 ✓`
  // directly beneath `D2 ✗`, which is the originating defect verbatim.
  it("a rung above the stop is the gated em-dash, NEVER a pass mark", () => {
    render(<StarterCell slug={COL} model={trio()} />);
    const strip = screen.getByTestId(`starter-rungs-${COL}`);
    // Exactly one pass mark in the whole strip: D1. D3 is gated.
    expect(strip.textContent?.split(GLYPHS.pass.mark).length).toBe(2);
    expect(strip.textContent).toContain(`D3 ${GLYPHS.gated.mark}`);
  });

  // MUTATION THAT REDS THIS: wrap the rung marks in `StatusChip` (the filled
  // verdict chip) instead of `Badge` — the approved visual puts exactly ONE
  // filled object in the cell, the depth chip, and the rungs are bare marks.
  it("the rungs are BARE marks — the depth chip is the cell's only filled object", () => {
    render(<StarterCell slug={COL} model={trio()} />);
    expect(screen.getAllByTestId("depth-chip")).toHaveLength(1);
    const strip = screen.getByTestId(`starter-rungs-${COL}`);
    // `data-glyph-form` is the vocabulary's own discriminator: `bare` is a
    // prefix + coloured glyph with no box; `solid`/`hollow` are the BOXED
    // chip forms `StatusChip` emits. Every rung must be bare.
    expect(strip.querySelectorAll("[data-glyph-form]")).toHaveLength(3);
    expect(strip.querySelectorAll('[data-glyph-form="bare"]')).toHaveLength(3);
    expect(
      strip.querySelectorAll(
        '[data-glyph-form="solid"], [data-glyph-form="hollow"]',
      ),
    ).toHaveLength(0);
  });
});

describe("StarterCell — absence is SHOWN, not suppressed", () => {
  // MUTATION THAT REDS THIS: `if (!model.supported) return null;` — the
  // suppression this phase exists to remove. A blank cell is indistinguishable
  // from "the dashboard dropped it".
  it("an unsupported column renders the hollow ∅ with the manifest's own reason", () => {
    render(
      <StarterCell
        slug={COL}
        model={unsupported()}
        declaration={{
          supported: false,
          reason: "no starter template exists for Spring AI",
        }}
      />,
    );
    const chip = screen.getByTestId(`starter-chip-${COL}`);
    expect(chip.getAttribute("data-starter-state")).toBe("unsupported");
    expect(chip.textContent).toBe(GLYPHS.notSupported.mark);
    expect(chip.getAttribute("title")).toContain(
      "no starter template exists for Spring AI",
    );
  });

  // MUTATION THAT REDS THIS: compute no-data as
  // `rungs.every((r) => r.state === "absent")`. `foldLadderCell` re-marks every
  // rung above the stop as `gated`, so a never-probed column is
  // `absent, gated, gated` and that predicate NEVER fires — the cell falls
  // through to a `D0` chip and claims a depth it never measured.
  it("a supported but never-reported column renders the hollow ?, not a D0 chip", () => {
    render(
      <StarterCell
        slug={COL}
        model={neverReported()}
        declaration={{ path: "starters/x" }}
      />,
    );
    const chip = screen.getByTestId(`starter-chip-${COL}`);
    expect(chip.getAttribute("data-starter-state")).toBe("no-data");
    expect(chip.textContent).toBe(GLYPHS.noData.mark);
    expect(screen.queryByTestId("depth-chip")).toBeNull();
  });

  it("emits no emoji-presentation code point in any of its three shapes", () => {
    for (const model of [trio(), neverReported(), unsupported()]) {
      const { container, unmount } = render(
        <StarterCell slug={COL} model={model} />,
      );
      expect(container.textContent ?? "").not.toMatch(
        /\p{Extended_Pictographic}/u,
      );
      unmount();
    }
  });
});

describe("starterCellTooltip", () => {
  // MUTATION THAT REDS THIS: drop the `rung.state === "red"` branch that
  // appends `fail_count` / `red since` — a one-tick regression and a 102-day
  // outage then read identically.
  it("names the stop's age and fail_count, and calls the gated rung gated", () => {
    const t = starterCellTooltip(trio());
    expect(t).toContain("Starter ladder: D1 of 3");
    expect(t).toContain("fail_count 2441");
    expect(t).toContain("red since 2026-06-04T09:40:02.000Z");
    expect(t).toMatch(/D3 chat \(mocked\): gated/);
    // The designed-but-unrun rungs are stated, so a green D3 cannot be read as
    // "fully verified".
    expect(t).toContain("designed, not implemented in v1");
  });

  it("a full ladder still discloses the unrun rungs", () => {
    expect(starterCellTooltip(full())).toContain("S4 tools, S5 state, S6 UI");
  });
});
