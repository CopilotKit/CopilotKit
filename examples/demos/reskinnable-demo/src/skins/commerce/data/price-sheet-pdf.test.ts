import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/commerce/v1/price-sheet/route";
import { buildPriceSheetPdf } from "./price-sheet-pdf";
import type { PriceSheetLine } from "./price-sheet-pdf";
import * as store from "./store";

/**
 * BEAT 3d's document — the narrative in it has to be TRUE of its own rows.
 *
 * The sheet used to carry a hardcoded explanation, "Driven by merino price and
 * the new freight surcharge below", under a rise the route puts on the Cedar
 * Hoodie and the Fern Cardigan while quoting the sheet's only merino SKU (Moss
 * Merino Scarf) FLAT. This is the one document the agent is asked to read out
 * loud, so a sentence its own numbers contradict does not stay in the PDF — it
 * comes back as something the assistant asserts to the room, sourced from an
 * artifact the audience was just shown.
 *
 * The vendor is a query parameter, so the row set is not fixed: these tests pin
 * the narrative against SEVERAL row sets, including one where nothing rose and
 * one where every style is new, so no direction, material or count can be baked
 * back in.
 */

/** Pull the visible text back out of the one-page PDF the builder emits. */
function pdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder().decode(bytes);
  return [...raw.matchAll(/\((.*?)\) Tj/g)]
    .map((m) => m[1].replace(/\\([()\\])/g, "$1"))
    .join("\n");
}

/**
 * Rejoin a sentence the page drew across more than one line.
 *
 * `buildPdf` wraps prose to the page (`@/shell/documents`), so a DRAWN line is no
 * longer the same thing as a SENTENCE — this sheet's count summary is 89
 * characters and now lands on two. Every assertion below is about the narrative,
 * not the typography, so the sentences have to be reassembled first. (Before the
 * shell wrapped, that summary simply ran off the right margin and was clipped by
 * the reader; these tests passed throughout, because they read the content stream
 * rather than the page.)
 *
 * The join rule is a property of the CONTENT, not of the wrap: every sentence
 * here ends in a full stop, so a line whose predecessor does not is that
 * predecessor's continuation. Re-implementing the writer's word-fitting to undo
 * it would make this test pass for the same reason the writer is correct.
 */
function rejoinWrapped(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const previous = out.at(-1);
    if (previous !== undefined && !previous.endsWith(".")) {
      out[out.length - 1] = `${previous} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * The SENTENCES between the "Cost movement" heading and the next section.
 *
 * THROWS rather than returning `[]` when the heading is gone: several assertions
 * below are of the form "the section says nothing rose", which an empty section
 * satisfies. Renaming the heading would have turned those into green checks on a
 * section that was never read. A locator that cannot find its region must fail,
 * not hand back a shape that passes.
 */
function movementSection(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf("Cost movement");
  if (start === -1) {
    throw new Error(
      "the price sheet has no `Cost movement` heading, so this section cannot be read",
    );
  }
  const end = lines.indexOf("Terms", start);
  return rejoinWrapped(lines.slice(start + 1, end === -1 ? undefined : end));
}

interface Claim {
  name: string;
  direction: string;
  from: number;
  to: number;
}

/** Every per-style movement claim the section makes. */
function claims(section: string[]): Claim[] {
  return section.flatMap((line) => {
    const m = /^(.+): (up|down) from \$(\d+) to \$(\d+) per unit\.$/.exec(line);
    return m
      ? [{ name: m[1], direction: m[2], from: Number(m[3]), to: Number(m[4]) }]
      : [];
  });
}

/** The quoted-cost table, keyed by style name. */
function tableCosts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^(BW-[A-Z-]+)\s+(.+?)\s+\$(\d+)\s+(\d+) units$/.exec(line);
    if (m) out.set(m[2], Number(m[3]));
  }
  return out;
}

const sheetFor = async (vendor?: string) => {
  const url =
    "http://bellwether.test/api/commerce/v1/price-sheet" +
    (vendor ? `?vendor=${encodeURIComponent(vendor)}` : "");
  const res = await GET(new Request(url));
  expect(res.status).toBe(200);
  return pdfText(new Uint8Array(await res.arrayBuffer()));
};

beforeEach(() => store.reset());

describe.each([["Kestrel Mills"], ["Halden Home"]])(
  "GET /api/commerce/v1/price-sheet?vendor=%s — the narrative matches the rows",
  (vendor) => {
    it("only claims a move for styles whose quote differs from their cost", async () => {
      const text = await sheetFor(vendor);
      const section = movementSection(text);
      const table = tableCosts(text);
      const costOf = new Map(
        store.products().map((p) => [p.name, p.unitCost] as const),
      );

      const moves = claims(section);
      expect(moves.length).toBeGreaterThan(0);
      expect(table.size).toBeGreaterThan(0);

      for (const claim of moves) {
        // "from" is what the app pays, "to" is what this sheet's own table quotes.
        expect(costOf.get(claim.name)).toBe(claim.from);
        expect(table.get(claim.name)).toBe(claim.to);
        expect(claim.direction).toBe(claim.to > claim.from ? "up" : "down");
      }

      // A style quoted at its current cost is never described as moving.
      const flat = [...table].filter(([name, quoted]) => {
        const current = costOf.get(name);
        return current !== undefined && current === quoted;
      });
      expect(flat.length).toBeGreaterThan(0); // the sheet really does hold one flat
      for (const [name] of flat) {
        expect(moves.map((c) => c.name)).not.toContain(name);
      }
    });

    it("carries claim lines and one derived count sentence — no other prose", async () => {
      const section = movementSection(await sheetFor(vendor));
      // Every line but the last is a per-style claim and NOTHING else, so no
      // explanation can ride along with it.
      for (const line of section.slice(0, -1)) {
        expect(line).toMatch(/^.+: (up|down) from \$\d+ to \$\d+ per unit\.$/);
      }
      const summary = section.at(-1) ?? "";
      expect(summary).toMatch(
        /^Of \d+ carried-over styles?: [\d a-z,]+\.( \d+ styles? quoted for the first time\.)?$/,
      );
      // Materials belong to style names in the table, never to the narrative.
      expect(summary).not.toMatch(
        /driven by|because|due to|surcharge|merino|wool|cotton|linen|leather/i,
      );
    });

    it("counts the carried-over styles the way the table does", async () => {
      const text = await sheetFor(vendor);
      const section = movementSection(text);
      const table = tableCosts(text);
      const costOf = new Map(
        store.products().map((p) => [p.name, p.unitCost] as const),
      );
      const carried = [...table.keys()].filter((n) => costOf.has(n));
      const moves = claims(section);
      const up = moves.filter((c) => c.direction === "up").length;
      const held = carried.length - moves.length;

      const summary = section.at(-1) ?? "";
      expect(summary).toContain(`Of ${carried.length} carried-over styles:`);
      expect(summary).toContain(`${up} up`);
      expect(summary).toContain(`${held} holding at last cost`);
      // The one style the app has never seen is counted, not described as a move.
      const fresh = table.size - carried.length;
      expect(summary).toContain(`${fresh} style quoted for the first time.`);
    });
  },
);

describe("buildPriceSheetPdf — row sets the seeded vendors do not produce", () => {
  const line = (
    name: string,
    currentCost: number | undefined,
    quotedCost: number,
  ): PriceSheetLine => ({
    sku: `BW-${name.slice(0, 3).toUpperCase()}-XXX`,
    name,
    currentCost,
    quotedCost,
    minimumUnits: 600,
  });

  const sheet = (lines: PriceSheetLine[]) =>
    movementSection(
      pdfText(
        buildPriceSheetPdf({ vendor: "Test Vendor", season: "Autumn", lines }),
      ),
    );

  it("says nothing rose when a vendor holds every quote", () => {
    const section = sheet([
      line("Flax Linen Throw", 55, 55),
      line("Terra Mug Set", 21, 21),
    ]);
    expect(section.join("\n")).not.toMatch(/\bup\b/);
    expect(claims(section)).toEqual([]);
    expect(section.at(-1)).toBe(
      "Of 2 carried-over styles: 2 holding at last cost.",
    );
  });

  it("says down when a vendor quotes down, rather than assuming a rise", () => {
    const section = sheet([
      line("Terra Mug Set", 21, 18),
      line("Ember Candle", 19, 19),
    ]);
    expect(claims(section)).toEqual([
      { name: "Terra Mug Set", direction: "down", from: 21, to: 18 },
    ]);
    expect(section.at(-1)).toBe(
      "Of 2 carried-over styles: 1 down, 1 holding at last cost.",
    );
  });

  it("reports a mixed sheet in both directions", () => {
    const section = sheet([
      line("Cedar Hoodie", 47, 51),
      line("Terra Mug Set", 21, 18),
    ]);
    expect(claims(section).map((c) => c.direction)).toEqual(["up", "down"]);
    expect(section.at(-1)).toBe("Of 2 carried-over styles: 1 up, 1 down.");
  });

  it("omits the section entirely when every style is new to the range", () => {
    const text = pdfText(
      buildPriceSheetPdf({
        vendor: "Test Vendor",
        season: "Autumn",
        lines: [line("Alder Crewneck", undefined, 52)],
      }),
    );
    expect(text).toContain("Quoted landed costs");
    expect(text).not.toContain("Cost movement");
  });

  it("agrees with itself for a single carried style", () => {
    const section = sheet([line("Cedar Hoodie", 47, 51)]);
    expect(section.at(-1)).toBe("Of 1 carried-over style: 1 up.");
  });
});
