import { describe, expect, it } from "vitest";
import { PDF_METRICS, buildPdf, charBudget, toAscii } from "@/shell/documents";
import type { Line } from "@/shell/documents";

/**
 * The GENERIC half of what `price-sheet-pdf.layout.test.ts` used to assert about
 * commerce's builder: the mechanism, not the price sheet. Five properties, all of
 * which fail by emitting a VALID PDF that is wrong on screen, and none of which
 * anything type-checks — a well-formed single page with a correct xref, a
 * `/Length` that matches the stream it wraps, every referenced `/Fn` declared,
 * `mono` lines drawn in a Courier face, and metrics a caller can bound its
 * columns against.
 */

const DOC: Line[] = [
  { text: "Test Document", size: 16, bold: true },
  { text: "A plain sentence of prose.", gap: 12 },
  { text: "SKU        QTY   PRICE", mono: true, bold: true, gap: 12 },
  { text: "ABC-100      4   $12.50", mono: true },
];

/** latin1: one byte, one character — correct for byte-offset assertions. */
const decode = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

/**
 * Every string the page actually DRAWS, in order, as the stream carries it —
 * i.e. escaped and folded. Wrapping assertions have to read this rather than the
 * `Line[]` handed in, because the whole failure mode is a line that was drawn
 * differently from how it was written.
 */
const drawnLines = (bytes: Uint8Array): string[] =>
  [...contentStreamOf(decode(bytes)).matchAll(/^\((.*)\) Tj$/gm)].map(
    (m) => m[1],
  );

/** The face each resource name must resolve to, per the builder's FONTS table. */
const EXPECTED_FACES: Record<string, string> = {
  F1: "Helvetica",
  F2: "Helvetica-Bold",
  F3: "Courier",
  F4: "Courier-Bold",
};

const contentStreamOf = (text: string) =>
  /stream\n([\s\S]*?)\nendstream/.exec(text)![1];

/**
 * Resource name -> object number, read from the PAGE's /Font dictionary.
 *
 * Kept separate from the font objects below on purpose: the dictionary is a set
 * of PROMISES ("/F1 is object 5") and the objects are whether those promises are
 * kept. Reading both and joining them is the only way to catch a dictionary that
 * points at an object number nothing emitted — which renders every glyph blank
 * while remaining a structurally valid PDF.
 */
function fontDictionary(text: string): Map<string, number> {
  const dict = /\/Font\s*<<([^>]*)>>/.exec(text);
  expect(dict, "the page declares a /Font resource dictionary").toBeTruthy();
  const out = new Map<string, number>();
  for (const match of dict![1].matchAll(/\/(F\d)\s+(\d+)\s+0\s+R/g)) {
    out.set(match[1], Number(match[2]));
  }
  return out;
}

/** Object number -> BaseFont, from each font object the document actually emits. */
function fontObjects(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const match of text.matchAll(
    /(\d+) 0 obj\n<< \/Type \/Font [^>]*\/BaseFont \/([\w-]+) >>/g,
  )) {
    out.set(Number(match[1]), match[2]);
  }
  return out;
}

/** Which resource each `Tf` in the CONTENT STREAM selects, in draw order. */
function referencedFonts(stream: string): Set<string> {
  return new Set(
    [...stream.matchAll(/^\/(F\d) [\d.]+ Tf$/gm)].map((m) => m[1]),
  );
}

describe("toAscii", () => {
  it("folds the typographic punctuation that breaks base-14 fonts", () => {
    expect(toAscii("an em—dash")).toBe("an em-dash");
    expect(toAscii("an en–dash")).toBe("an en-dash");
    expect(toAscii("“curly” and ‘single’")).toBe("\"curly\" and 'single'");
    expect(toAscii("2×3 rib…")).toBe("2x3 rib...");
    // The middot is the fold map's last entry; without this it is the one
    // mapping no test exercises.
    expect(toAscii("Reno DC · week 6")).toBe("Reno DC - week 6");
  });

  /**
   * WHY A LETTER TRANSLITERATES AND A SYMBOL DOES NOT.
   *
   * These strings are not hypothetical: "Inés Vidal", "Sasha Bergström" and
   * "Montréal" are people's seed values reachable through its offer-letter route,
   * and "Émile & Fils"/"Crème Brûlée" are commerce's. All of them are PROJECTED
   * and read back by the agent, so "In?s Vidal" is a visible defect even though
   * the bytes are valid. An accented letter has a base letter to fall back to; a
   * CJK ideograph does not, and dropping it would be a silent corruption where a
   * "?" is a legible one.
   */
  it("transliterates accented letters instead of blanking them", () => {
    expect(toAscii("Inés Vidal")).toBe("Ines Vidal");
    expect(toAscii("Sasha Bergström")).toBe("Sasha Bergstrom");
    expect(toAscii("Montréal")).toBe("Montreal");
    expect(toAscii("Crème Brûlée")).toBe("Creme Brulee");
    expect(toAscii("ÉMILE & FILS")).toBe("EMILE & FILS");
  });

  it("still marks a character with no ASCII base rather than dropping it", () => {
    // A dropped character is a silent corruption; a "?" is a legible one.
    expect(toAscii("東京")).toBe("??");
  });

  /**
   * The mark-stripping pass runs over the WHOLE string, so it has to leave the
   * ASCII characters Unicode also calls diacritics alone — "^" and "`" are
   * `Diacritic=Yes`, and deleting them out of prose is exactly the regression a
   * `\p{Diacritic}` class would have shipped.
   */
  it("leaves standalone ASCII accent characters in place", () => {
    expect(toAscii("2^3 and a `quoted` token")).toBe(
      "2^3 and a `quoted` token",
    );
  });

  it("leaves plain ASCII untouched", () => {
    expect(toAscii("Plain ASCII 123 $4.50")).toBe("Plain ASCII 123 $4.50");
  });
});

describe("buildPdf", () => {
  it("emits only single-byte characters, even from accented input", () => {
    // Once the document is ASCII, characters and bytes are the same thing —
    // which is exactly why a /Length assertion decoded as UTF-8 would pass for
    // the same reason the builder is correct, and would desync in step with it
    // if the fold were relaxed. So assert the BYTES.
    const bytes = buildPdf([{ text: "Inés Vidal, Montréal — naïve “café”" }]);
    for (const b of bytes) expect(b).toBeLessThan(0x80);
  });

  it("is a well-formed single-page PDF whose every xref entry points at its object", () => {
    // A wrong OFFSET is the failure this module now owns: the document stays
    // structurally valid and a reader either renders nothing or renders the
    // wrong object, so checking only that `startxref` lands on the literal
    // "xref" would leave the entries themselves — the part a reader genuinely
    // refuses to guess at — unasserted. Byte offsets throughout: `decode` is
    // latin1, so string indices ARE byte offsets.
    const text = decode(buildPdf(DOC));
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    // No trimEnd: the trailing newline after %%EOF is part of the layout.
    expect(text.endsWith("%%EOF\n")).toBe(true);

    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");

    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    // Catalog, Pages, Page and Contents, then one object per declared face.
    expect(entries.length).toBe(4 + Object.keys(EXPECTED_FACES).length);
    entries.forEach((offset, index) => {
      const header = `${index + 1} 0 obj`;
      expect(text.slice(offset, offset + header.length), header).toBe(header);
    });
    // /Size counts the free object 0 as well as every entry above.
    expect(Number(/\/Size (\d+)/.exec(text)![1])).toBe(entries.length + 1);
  });

  it("declares a /Length that matches the content stream it wraps", () => {
    const text = decode(buildPdf(DOC));
    const declared = Number(/\/Length (\d+)/.exec(text)![1]);
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)![1];
    expect(stream.length).toBe(declared);
  });

  it("resolves every font the content stream references to the right font object", () => {
    // A referenced /Fn that does not resolve to an emitted font object renders
    // BLANK, which is worse than ragged. Following the chain end to end is what
    // makes this test able to fail: scanning the whole document for "/Fn" would
    // harvest the page's own /Font dictionary and pass no matter what the stream
    // asks for, and asserting the dictionary merely CONTAINS "/Fn <n> 0 R" is
    // asserting the substring just matched. So: stream -> dictionary -> object,
    // with the BaseFont at the end of it checked against the expected face.
    const text = decode(buildPdf(DOC));
    const referenced = referencedFonts(contentStreamOf(text));
    // DOC exercises all four faces, so the join below covers every declared one.
    expect(referenced).toEqual(new Set(Object.keys(EXPECTED_FACES)));

    const dictionary = fontDictionary(text);
    const objects = fontObjects(text);
    for (const ref of referenced) {
      const objectNumber = dictionary.get(ref);
      expect(
        objectNumber,
        `${ref} is in the page's /Font dictionary`,
      ).toBeTypeOf("number");
      expect(
        objects.get(objectNumber!),
        `${ref} -> object ${objectNumber} is an emitted ${EXPECTED_FACES[ref]}`,
      ).toBe(EXPECTED_FACES[ref]);
    }
  });

  it("draws every mono line in a Courier face and no other line in one", () => {
    // THE PROPERTY. Character padding only aligns in a fixed-advance font, so a
    // `mono` line drawn in Helvetica is a valid PDF with a visibly ragged table.
    // Pair each drawn string with the face in force when it was drawn, rather
    // than just asserting both Courier resources appear somewhere.
    const stream = contentStreamOf(decode(buildPdf(DOC)));
    const drawn: { font: string; text: string }[] = [];
    let font = "";
    for (const raw of stream.split("\n")) {
      const tf = /^\/(F\d) [\d.]+ Tf$/.exec(raw);
      if (tf) font = tf[1];
      const tj = /^\((.*)\) Tj$/.exec(raw);
      if (tj) drawn.push({ font, text: tj[1] });
    }
    expect(drawn.map((d) => d.text)).toEqual(DOC.map((l) => l.text));
    // Courier is /F3 (regular) and /F4 (bold); Helvetica is /F1 and /F2.
    DOC.forEach((line, index) => {
      expect(drawn[index].font, line.text).toBe(
        line.mono ? (line.bold ? "F4" : "F3") : line.bold ? "F2" : "F1",
      );
    });
  });

  it("wraps a prose line that would run off the page, on word boundaries", () => {
    // THE PROPERTY, and it fails the way every other one here does: nothing
    // measures as it draws, so before this an over-long line ran past the right
    // margin and the reader clipped it — a valid PDF that is wrong on screen, in
    // the paragraph a caller is most likely to have DERIVED and least likely to
    // have eyeballed. Logistics shipped a 111-character sentence that ran a
    // third of the way off the page.
    const sentence =
      "SHA-OAK ocean is new service at $0.49 per kg, 21 days transit, " +
      "and there is no prior rate on file with Meridian for this lane at all.";
    const drawn = drawnLines(buildPdf([{ text: sentence }]));
    expect(drawn.length).toBeGreaterThan(1);
    for (const line of drawn) {
      expect(line.length, line).toBeLessThanOrEqual(charBudget());
    }
    // Every word survives, in order, and none was split: hyphenating an
    // identifier would invent one that does not exist, and these are read aloud.
    expect(drawn.join(" ")).toBe(sentence);
  });

  it("measures the ESCAPED text, not the string the caller passed", () => {
    // `pdfEscape` turns one "(" into two characters and `toAscii` turns one "…"
    // into three, so a budget checked against the RAW string is wrong by exactly
    // the amount a punctuation-heavy sentence needs it to be right. This is what
    // a skin-side wrap could not do — the escape is private to the writer — and
    // it is why that copy came back here.
    //
    // Built to sit just inside the budget raw and just outside it escaped: a
    // wrap measuring the raw string leaves this on ONE line, over the margin.
    const budget = charBudget();
    const parens = "(a)".repeat(8); // 24 raw, 40 escaped
    const filler = "w".repeat(budget - parens.length - 1);
    const drawn = drawnLines(buildPdf([{ text: `${filler} ${parens}` }]));
    expect(drawn.length).toBe(2);
    for (const line of drawn) {
      expect(line.length, line).toBeLessThanOrEqual(budget);
    }
  });

  it("never wraps a mono line, whose spacing is the point", () => {
    // Wrapping a columnar line would break the alignment it exists to keep, so
    // a `mono` line that does not fit stays the CALLER's bug to assert against
    // PDF_METRICS. It must arrive intact, however long.
    const row = "SKU-1234567890".padEnd(200, " ") + "$12.50";
    const drawn = drawnLines(buildPdf([{ text: row, mono: true }]));
    expect(drawn).toEqual([row]);
  });

  it("opens a section once, not once per wrapped line", () => {
    // A continuation inheriting its parent's `gap` would space a paragraph like
    // a list — the sentence's second half pushed down as if it began a section.
    const long = "gap ".repeat(40).trim();
    const text = decode(buildPdf([{ text: long, gap: 40 }]));
    const ys = [...text.matchAll(/1 0 0 1 \d+ ([\d.]+) Tm/g)].map((m) =>
      Number(m[1]),
    );
    expect(ys.length).toBeGreaterThan(1);
    const drops = ys.slice(1).map((y, i) => ys[i] - y);
    // Every continuation drops by the same plain leading; only the first line
    // paid the gap, and it is not in this list.
    expect(new Set(drops).size).toBe(1);
    expect(drops[0]).toBeLessThan(40);
  });

  it("publishes metrics a caller can bound its columns against", () => {
    expect(PDF_METRICS.monoAdvance).toBeCloseTo(0.6);
    // Letter width less both margins. Asserted outright rather than "> 0",
    // which a MARGIN wide enough to leave no usable column would also satisfy.
    expect(PDF_METRICS.drawableWidth).toBe(496);
    // The bound callers actually compute: chars that fit at a given point size.
    const charsAt9pt = Math.floor(
      PDF_METRICS.drawableWidth / (9 * PDF_METRICS.monoAdvance),
    );
    expect(charsAt9pt).toBeGreaterThan(40);
  });
});
