import { describe, expect, it } from "vitest";
import {
  buildRateSheetPdf,
  costMovementLines,
  newServiceLines,
  RATE_SHEET_METRICS,
  wrapProse,
} from "./rate-sheet-pdf";
import type { RateSheetLane } from "./rate-sheet-pdf";
import { PDF_METRICS } from "@/shell/documents";

const LANES: RateSheetLane[] = [
  {
    lane: "MX-LAX",
    mode: "truck",
    oldRateUsdPerKg: 2.4,
    newRateUsdPerKg: 2.85,
  },
  {
    lane: "SHA-LGB",
    mode: "ocean",
    oldRateUsdPerKg: 1.1,
    newRateUsdPerKg: 1.1,
  },
  { lane: "FRA-JFK", mode: "air", oldRateUsdPerKg: 6.2, newRateUsdPerKg: 5.8 },
];

// The byte-level invariants — the ASCII fold, /Length vs the real byte count,
// every referenced /Fn declared, the xref offset — are NOT retested here. They
// belong to `@/shell/documents` and are covered once, for all six skins, in
// `src/shell/documents/pdf.test.ts`. Duplicating them here would be the kind of
// decorative assertion that passes for the same reason the code is correct.
// What IS this skin's own is the content: the sentences and the row set.

describe("costMovementLines", () => {
  it("names a direction it computed, for lanes that actually moved", () => {
    const lines = costMovementLines(LANES).join(" ");
    expect(lines).toContain("MX-LAX");
    expect(lines).toMatch(/MX-LAX[^.]*(up|increase|rise)/i);
    expect(lines).toContain("FRA-JFK");
    expect(lines).toMatch(/FRA-JFK[^.]*(down|decrease|fall)/i);
  });

  it("never asserts a movement for a flat lane", () => {
    // Commerce shipped a hardcoded "Driven by merino price" under a rise the
    // route put on two non-merino styles while quoting its only merino SKU flat.
    const lines = costMovementLines(LANES).join(" ");
    expect(lines).not.toMatch(/SHA-LGB[^.]*(up|down|increase|decrease)/i);
  });

  it("says nothing at all when no lane moved", () => {
    const flat: RateSheetLane[] = [
      {
        lane: "SHA-LGB",
        mode: "ocean",
        oldRateUsdPerKg: 1.1,
        newRateUsdPerKg: 1.1,
      },
    ];
    expect(costMovementLines(flat)).toEqual([]);
  });

  it("asserts no movement on a lane with no prior rate on file", () => {
    // The fresh lane — the row the live network cannot supply — has no
    // `oldRateUsdPerKg` at all. A movement sentence about it would be inventing
    // a rate history the app has never had, and `(new - undefined)` would print
    // "NaN%" into a document the agent reads aloud.
    const fresh: RateSheetLane[] = [
      { lane: "SHA-OAK", mode: "ocean", newRateUsdPerKg: 0.49 },
    ];
    expect(costMovementLines(fresh)).toEqual([]);
  });

  it("states the two rates it computed the direction from", () => {
    // The percentage is the claim most easily wrong and least easily checked on
    // stage, so the sentence has to carry the two figures it was derived from.
    const [line] = costMovementLines([LANES[0]]);
    expect(line).toContain("$2.40");
    expect(line).toContain("$2.85");
    expect(line).toContain("18.8%");
  });
});

describe("buildRateSheetPdf", () => {
  const pdf = buildRateSheetPdf({
    carrier: "Ardent Freight",
    asOf: "26 August 2026",
    lanes: [
      ...LANES,
      { lane: "SHA-OAK", mode: "ocean", newRateUsdPerKg: 0.49 },
    ],
  });
  const text = new TextDecoder().decode(pdf);

  it("prints every lane the sheet was built from", () => {
    for (const lane of ["MX-LAX", "SHA-LGB", "FRA-JFK", "SHA-OAK"]) {
      expect(text).toContain(lane);
    }
  });

  it("keeps the columnar rows inside the drawable width", () => {
    // The alignment contract from `@/shell/documents`, asserted rather than
    // eyeballed: a mono row is only aligned while it FITS, and a row that
    // overruns the margin is silently clipped by the reader.
    const widest = Object.values(RATE_SHEET_METRICS.columns).reduce(
      (sum, width) => sum + width,
      0,
    );
    const budget = Math.floor(
      PDF_METRICS.drawableWidth /
        (RATE_SHEET_METRICS.bodySize * PDF_METRICS.monoAdvance),
    );
    expect(widest).toBeLessThanOrEqual(budget);
  });

  it("draws no line past the right margin", () => {
    // The shell's writer draws at a fixed x and never wraps, so a line that does
    // not fit is CLIPPED by the reader — silently, on a page that is otherwise
    // perfectly valid. This file shipped a 111-character "New service" sentence
    // that ran a third of the way off the page before this assertion existed.
    const drawn = [
      ...text.matchAll(
        /\/F\d ([\d.]+) Tf\n1 0 0 1 \d+ [\d.-]+ Tm\n\((.*)\) Tj/g,
      ),
    ];
    expect(drawn.length).toBeGreaterThan(10);
    for (const [, size, body] of drawn) {
      const budget = Math.floor(
        PDF_METRICS.drawableWidth /
          (Number(size) * RATE_SHEET_METRICS.monoAdvance),
      );
      expect(body.length, `overruns the margin: ${body}`).toBeLessThanOrEqual(
        budget,
      );
    }
  });

  it("wraps a long derived sentence on word boundaries rather than clipping it", () => {
    const wrapped = wrapProse(
      "SHA-OAK (ocean) is new service at $0.49 per kg, 21 days transit — no prior rate on file with Meridian.",
      RATE_SHEET_METRICS.bodySize,
    );
    expect(wrapped.length).toBeGreaterThan(1);
    // No word is ever split: hyphenating a lane code would invent a code that
    // does not exist, and the agent reads these lines aloud.
    expect(wrapped.join(" ")).toContain("SHA-OAK");
    expect(wrapped.join(" ").split(/\s+/)).toEqual(
      "SHA-OAK (ocean) is new service at $0.49 per kg, 21 days transit — no prior rate on file with Meridian."
        .split(" ")
        .filter(Boolean),
    );
  });

  it("says a lane has no prior rate rather than quoting one it does not have", () => {
    // Asserted on the sentence rather than on the page text, because the wrap
    // above may legitimately break the phrase across two drawn lines.
    expect(
      newServiceLines([
        { lane: "SHA-OAK", mode: "ocean", newRateUsdPerKg: 0.49 },
      ]).join(" "),
    ).toContain("no prior rate on file");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });

  it("states a transit the row carries without claiming how it moves", () => {
    // The sheet quotes truck and rail lanes too, so "port to port" would be a
    // detail the row does not support — and the agent reads these aloud.
    const [truck] = newServiceLines([
      { lane: "MTY-HOU", mode: "truck", newRateUsdPerKg: 0.84, transitDays: 2 },
    ]);
    expect(truck).toContain("2 days transit");
    expect(truck).not.toContain("port");
  });
});
