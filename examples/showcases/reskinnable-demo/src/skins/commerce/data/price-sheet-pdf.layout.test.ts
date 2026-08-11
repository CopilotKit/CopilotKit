import { describe, expect, it } from "vitest";
import { buildPriceSheetPdf, PRICE_SHEET_METRICS } from "./price-sheet-pdf";
import type { PriceSheetInput } from "./price-sheet-pdf";

/**
 * BEAT 3d's document. This PDF is PROJECTED ON SCREEN and then fed to the model
 * as an attachment, so its typography is part of the claim it is making.
 *
 * The invariant under test is alignment, which is visual and therefore untestable
 * as pixels here. What IS testable is the mechanism alignment rests on: the table
 * is spaced by CHARACTER COUNT (`padEnd`), which is only true in a monospaced
 * font. Drawn in Helvetica — as this file did until the columns were moved to
 * Courier — every row starts its next column somewhere new and the table renders
 * visibly ragged while still being a perfectly valid PDF. Nothing type-checks it
 * and no other test opens the bytes, so these assertions are the only thing
 * standing between a regression and a ragged table on stage.
 *
 * So: parse the emitted PDF, and assert (a) every font the content stream
 * references is actually declared — a dangling `/Fn` is worse than ragged, it is
 * blank — (b) every columnar line is drawn in a Courier face, (c) the column
 * origins are identical on every row, and (d) no row can overflow the page.
 *
 * TWO UNITS LIVE IN THIS FILE, and mixing them up is how the byte-layout guard
 * below nearly became decorative:
 *
 *   - GLYPHS. Alignment, truncation and page-fit are claims about what is drawn,
 *     so they count characters — `parsePdf` decodes UTF-8 for them.
 *   - BYTES. `/Length` and every xref offset are byte offsets by spec, so the
 *     structural assertions count bytes — `byteImage` decodes one byte to one
 *     character so that string indices ARE byte offsets.
 *
 * The builder computes both `/Length` and its xref offsets from JS string length
 * (UTF-16 code units) and then emits UTF-8, so those two agree ONLY while the
 * document is pure ASCII. That is not a happy accident to be left implicit: it is
 * `toAscii`'s job, and "emits a pure-ASCII document however the input is spelled"
 * below is the test that pins it. Nothing else does.
 */

const INPUT: PriceSheetInput = {
  vendor: "Kestrel Mills",
  season: "Autumn",
  lines: [
    {
      sku: "BW-HRR-TEE",
      name: "Harrier Pocket Tee",
      currentCost: 12,
      quotedCost: 13,
      minimumUnits: 1200,
    },
    {
      sku: "BW-MER-CRW-XL",
      // Deliberately longer than the style column, to prove truncation keeps a
      // gutter rather than shoving the cost column right.
      name: "Merino Crewneck, Extended Sizing, Heather",
      currentCost: 44,
      quotedCost: 48,
      minimumUnits: 600,
    },
    {
      sku: "BW-ALD-CRW",
      name: "Alder Crewneck",
      quotedCost: 52,
      minimumUnits: 900,
    },
  ],
};

/** A single drawn line of text: which font resource, at what size, and what. */
interface DrawnLine {
  font: string;
  size: number;
  text: string;
}

interface ParsedPdf {
  /** Resource name -> object number, from the page's /Font dictionary. */
  fontResources: Map<string, number>;
  /** Object number -> BaseFont, from each declared font object. */
  baseFonts: Map<number, string>;
  lines: DrawnLine[];
}

/**
 * A deliberately small PDF reader: enough to see the page's font dictionary, the
 * font objects, and the `Tf`/`Tj` pairs in the content stream. It parses the
 * emitted bytes rather than re-deriving them from the builder's internals, so it
 * would catch a font that is referenced but never declared.
 */
function parsePdf(bytes: Uint8Array): ParsedPdf {
  const source = new TextDecoder().decode(bytes);

  const fontDict = /\/Font\s*<<([^>]*)>>/.exec(source);
  expect(
    fontDict,
    "the page declares a /Font resource dictionary",
  ).toBeTruthy();
  const fontResources = new Map<string, number>();
  for (const match of fontDict![1].matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
    fontResources.set(match[1], Number(match[2]));
  }

  const baseFonts = new Map<number, string>();
  for (const match of source.matchAll(
    /(\d+) 0 obj\n<< \/Type \/Font [^>]*\/BaseFont \/([\w-]+) >>/g,
  )) {
    baseFonts.set(Number(match[1]), match[2]);
  }

  const streamBody = /stream\n([\s\S]*?)\nendstream/.exec(source);
  expect(streamBody, "the page has a content stream").toBeTruthy();

  const lines: DrawnLine[] = [];
  let font = "";
  let size = 0;
  for (const raw of streamBody![1].split("\n")) {
    const tf = /^\/(\w+) ([\d.]+) Tf$/.exec(raw);
    if (tf) {
      font = tf[1];
      size = Number(tf[2]);
      continue;
    }
    const tj = /^\((.*)\) Tj$/.exec(raw);
    // Undo the literal-string escaping, so a line's length here is the number of
    // GLYPHS drawn — which is what the alignment and width assertions reason about.
    if (tj)
      lines.push({ font, size, text: tj[1].replace(/\\([()\\])/g, "$1") });
  }
  return { fontResources, baseFonts, lines };
}

/**
 * The document as BYTES, one byte per character.
 *
 * `latin1` is the only decoder with that property: every byte 0x00-0xff maps to
 * exactly one code point, so `.length`, `.slice` and index arithmetic over the
 * result are byte-exact even for a document that is not ASCII. The default UTF-8
 * decoder is not usable here — it collapses a three-byte em dash into one
 * character, which is precisely the drift these assertions exist to catch, so
 * asserting byte offsets against a UTF-8 decode would desync the test the same
 * way the builder desyncs and could never fail.
 */
const byteImage = (bytes: Uint8Array) =>
  new TextDecoder("latin1").decode(bytes);

/** Every xref entry points at the "N 0 obj" it claims to. Byte offsets. */
function expectCorrectXref(source: string) {
  expect(source.startsWith("%PDF-1.4\n")).toBe(true);
  expect(source.endsWith("%%EOF\n")).toBe(true);

  const startxref = Number(/startxref\n(\d+)/.exec(source)![1]);
  expect(source.slice(startxref, startxref + 4)).toBe("xref");
  const entries = [...source.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
    Number(m[1]),
  );
  expect(entries.length).toBeGreaterThan(0);
  entries.forEach((offset, index) => {
    expect(source.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(
      `${index + 1} 0 obj`,
    );
  });
  expect(Number(/\/Size (\d+)/.exec(source)![1])).toBe(entries.length + 1);
}

/** The declared `/Length` is the stream's byte count, not its glyph count. */
function expectCorrectStreamLength(source: string) {
  const declared = Number(/\/Length (\d+)/.exec(source)![1]);
  expect(/stream\n([\s\S]*?)\nendstream/.exec(source)![1].length).toBe(
    declared,
  );
}

const baseFontOf = (pdf: ParsedPdf, resource: string) =>
  pdf.baseFonts.get(pdf.fontResources.get(resource) ?? -1);

/** Lines whose spacing carries meaning: the cost table and the ship schedule. */
function columnarLines(pdf: ParsedPdf) {
  const table = pdf.lines.filter((l) => /^SKU\s|^BW-/.test(l.text));
  const schedule = pdf.lines.filter((l) => /^Week \d/.test(l.text));
  return { table, schedule };
}

describe("price sheet PDF", () => {
  const pdf = parsePdf(buildPriceSheetPdf(INPUT));

  it("is a well-formed single-page PDF with a correct xref", () => {
    expectCorrectXref(byteImage(buildPriceSheetPdf(INPUT)));
  });

  it("declares every font the content stream references", () => {
    // A dangling /Fn renders blank or corrupt in most readers — strictly worse
    // than the ragged table this fix was about.
    const referenced = new Set(pdf.lines.map((l) => l.font));
    expect(referenced.size).toBeGreaterThan(1);
    for (const resource of referenced) {
      expect(
        pdf.fontResources.get(resource),
        `${resource} is in the page's /Font dictionary`,
      ).toBeTypeOf("number");
      expect(
        baseFontOf(pdf, resource),
        `${resource} resolves to a declared font object`,
      ).toBeTypeOf("string");
    }
  });

  it("declares a /Length that matches the content stream it wraps", () => {
    expectCorrectStreamLength(byteImage(buildPriceSheetPdf(INPUT)));
  });

  it("draws every columnar line in a monospaced face", () => {
    // THE FIX. Character padding only aligns in a fixed-advance font; these lines
    // are padded, so they must not be drawn in Helvetica.
    const { table, schedule } = columnarLines(pdf);
    expect(table.length).toBe(INPUT.lines.length + 1); // header + one per SKU
    expect(schedule.length).toBe(5);
    for (const line of [...table, ...schedule]) {
      expect(baseFontOf(pdf, line.font), line.text).toMatch(/^Courier/);
    }
    // ...and the prose around them is NOT mono, or the sheet stops looking like a
    // document. The signature line is the check.
    const signature = pdf.lines.find((l) => l.text === "Ilse Ruijter");
    expect(baseFontOf(pdf, signature!.font)).toBe("Helvetica-Bold");
  });

  it("starts every table column at the identical character offset", () => {
    const { columns } = PRICE_SHEET_METRICS;
    const costAt = columns.sku + columns.style;
    const moqAt = costAt + columns.cost;
    const { table } = columnarLines(pdf);

    for (const { text } of table) {
      // Each column begins with a non-space at its own fixed offset, and the
      // preceding character is a space — i.e. the gutter survived truncation.
      for (const at of [columns.sku, costAt, moqAt]) {
        expect(text[at], `${JSON.stringify(text)} at ${at}`).not.toBe(" ");
        expect(text[at - 1], `gutter before ${at}`).toBe(" ");
      }
    }
    // The header and the body agree on where the columns are.
    expect(table[0].text.indexOf("Style")).toBe(columns.sku);
    expect(table[0].text.indexOf("Cost")).toBe(costAt);
    expect(table[0].text.indexOf("MOQ")).toBe(moqAt);
    for (const { text } of table.slice(1)) {
      expect(text[costAt]).toBe("$");
      expect(text.slice(moqAt)).toMatch(/^\d+ units$/);
    }
  });

  it("aligns the ship schedule's milestone column too", () => {
    const { weekLabelWidth } = PRICE_SHEET_METRICS;
    for (const { text } of columnarLines(pdf).schedule) {
      // "Week 1" and "Week 10" are different lengths; padding to a fixed cell is
      // what keeps the milestones flush.
      expect(text[weekLabelWidth]).not.toBe(" ");
      expect(text[weekLabelWidth - 1]).toBe(" ");
    }
  });

  it("keeps every mono line inside the drawable width", () => {
    // Fixed advance also makes overflow arithmetic — worth asserting, because a
    // wider column set would silently run off the right edge of the page.
    const { monoAdvance, drawableWidth } = PRICE_SHEET_METRICS;
    const { table, schedule } = columnarLines(pdf);
    for (const line of [...table, ...schedule]) {
      expect(
        line.text.length * monoAdvance * line.size,
        `${line.text} fits`,
      ).toBeLessThanOrEqual(drawableWidth);
    }
  });

  it("truncates an over-long style without shifting the cost column", () => {
    const { columns } = PRICE_SHEET_METRICS;
    const long = columnarLines(pdf).table.find((l) =>
      l.text.startsWith("BW-MER-CRW-XL"),
    )!;
    const style = long.text.slice(columns.sku, columns.sku + columns.style);
    expect(style.length).toBe(columns.style);
    // Truncated to width - 1, so a gutter always survives.
    expect(style.trimEnd().length).toBe(columns.style - 1);
    expect(long.text.slice(0, columns.sku)).toBe(
      "BW-MER-CRW-XL".padEnd(columns.sku),
    );
  });
});

/**
 * THE INVARIANT EVERYTHING ABOVE RESTS ON, and the one nothing used to check.
 *
 * `toAscii` (`price-sheet-pdf.ts`) is what makes this a document whose characters
 * and bytes are the same thing — which is what lets the builder compute `/Length`
 * and its xref offsets from JS string length, and what lets base-14 fonts render
 * every glyph the stream asks for. It was asserted NOWHERE: relax it for an
 * accented vendor name and you get mojibake plus a corrupt byte table, with a
 * green suite. So this block feeds NON-ASCII down every text path and asserts the
 * OUTPUT is still ASCII — which is also the only way to prove the fold is applied
 * on every path in, rather than on the paths one fixture happens to use.
 */
describe("price sheet PDF — ASCII invariant", () => {
  /**
   * Every text path into the document: the vendor (drawn twice — masthead and
   * signature), the season, a SKU, a style name in the table, and a style name in
   * the prose `costMovementLines` derives. Numbers cannot carry non-ASCII and the
   * rest of the page is literal, so this is the whole surface.
   */
  const NON_ASCII_INPUT: PriceSheetInput = {
    vendor: "Kestrel Mills — Émile & Fils",
    season: "Autumn ’26 — “Harvest”",
    lines: [
      {
        sku: "BW-CRÈ-TEE",
        name: "Crème Brûlée Tee",
        currentCost: 12,
        quotedCost: 13,
        minimumUnits: 1200,
      },
      {
        sku: "BW-MOS-SCF",
        name: "Moss Scarf £18 / €21",
        currentCost: 44,
        quotedCost: 44,
        minimumUnits: 600,
      },
      {
        sku: "BW-ALD-CRW",
        name: "Alder 2×3 rib…",
        quotedCost: 52,
        minimumUnits: 900,
      },
    ],
  };

  it("emits a pure-ASCII document however the input is spelled", () => {
    const bytes = buildPriceSheetPdf(NON_ASCII_INPUT);
    const source = byteImage(bytes);
    const offenders = [...bytes].flatMap((byte, at) =>
      byte < 0x80
        ? []
        : [
            `0x${byte.toString(16)} at byte ${at}, near ` +
              JSON.stringify(source.slice(Math.max(0, at - 24), at + 24)),
          ],
    );
    // Reported rather than counted: a single leak is usually one unfolded
    // character, and its offset is the fastest way to the path that let it in.
    expect(offenders.slice(0, 3), "bytes outside ASCII").toEqual([]);
  });

  it("folds what it can and substitutes what it cannot, on every path", () => {
    const drawn = parsePdf(buildPriceSheetPdf(NON_ASCII_INPUT)).lines.map(
      (l) => l.text,
    );
    // Masthead and signature — the two places the vendor is drawn.
    expect(drawn).toContain("KESTREL MILLS - ?MILE & FILS");
    expect(drawn).toContain("Head of Wholesale, Kestrel Mills - ?mile & Fils");
    // The season, folded: curly quotes and an em dash have ASCII equivalents.
    expect(drawn).toContain(`Autumn '26 - "Harvest" price sheet`);
    // Derived prose, which quotes a style name back.
    expect(drawn).toContain("Cr?me Br?l?e Tee: up from $12 to $13 per unit.");
    // Table cells: the SKU column and a name carrying folded punctuation.
    expect(drawn.some((t) => t.startsWith("BW-CR?-TEE"))).toBe(true);
    expect(drawn.some((t) => t.includes("Alder 2x3 rib..."))).toBe(true);
  });

  it("keeps /Length and the xref byte-exact for that document too", () => {
    // The structural guards, re-run over the hostile input. Byte-exact by
    // construction (`byteImage`), so this fails rather than desyncing in step with
    // the builder if a non-ASCII byte ever reaches the page.
    const source = byteImage(buildPriceSheetPdf(NON_ASCII_INPUT));
    expectCorrectXref(source);
    expectCorrectStreamLength(source);
  });
});
