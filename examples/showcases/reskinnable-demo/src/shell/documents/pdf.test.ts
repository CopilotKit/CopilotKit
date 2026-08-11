import { describe, expect, it } from "vitest";
import { PDF_METRICS, buildPdf, toAscii } from "@/shell/documents";
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

describe("toAscii", () => {
  it("folds the typographic punctuation that breaks base-14 fonts", () => {
    expect(toAscii("an em—dash")).toBe("an em-dash");
    expect(toAscii("an en–dash")).toBe("an en-dash");
    expect(toAscii("“curly” and ‘single’")).toBe("\"curly\" and 'single'");
    expect(toAscii("2×3 rib…")).toBe("2x3 rib...");
  });

  /**
   * WHAT THIS PINS, AND WHY IT IS NOT A NICER ANSWER.
   *
   * `ASCII_FOLD` covers punctuation only, so a LETTER outside ASCII — an accent,
   * an umlaut — becomes "?" rather than its unaccented base. That is not an
   * oversight to quietly fix here: this module is a verbatim move of commerce's
   * builder, and commerce's own suite asserts exactly this substitution
   * ("Cr?me Br?l?e Tee", "?MILE & FILS") as the proof the fold runs on every text
   * path. Widening it to strip diacritics would change those bytes.
   *
   * It IS a real question for the skins about to adopt this primitive. People's
   * seed carries "Inés Vidal", "Sasha Bergström" and "Montréal", so its offer
   * letter renders "In?s Vidal" the moment it moves onto this fold — better than
   * the mojibake it emits today with no fold at all, worse than the name. Decide
   * that deliberately (NFD-normalize and strip combining marks, then fold) as its
   * own change with commerce's expectations updated in the same commit; do not
   * let it ride along inside a move.
   */
  it("substitutes, rather than transliterates, non-ASCII letters", () => {
    expect(toAscii("Inés Vidal")).toBe("In?s Vidal");
    expect(toAscii("Sasha Bergström")).toBe("Sasha Bergstr?m");
    expect(toAscii("Montréal")).toBe("Montr?al");
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

  it("is a well-formed single-page PDF whose startxref points at the xref table", () => {
    const text = decode(buildPdf(DOC));
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const declared = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(declared, declared + 4)).toBe("xref");
  });

  it("declares a /Length that matches the content stream it wraps", () => {
    const text = decode(buildPdf(DOC));
    const declared = Number(/\/Length (\d+)/.exec(text)![1]);
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)![1];
    expect(stream.length).toBe(declared);
  });

  it("declares every font the content stream references", () => {
    // A referenced but UNDECLARED /Fn renders blank, which is worse than ragged.
    const text = decode(buildPdf(DOC));
    const referenced = new Set(text.match(/\/F\d(?= )/g) ?? []);
    expect(referenced.size).toBeGreaterThan(1); // proportional + mono both used
    for (const ref of referenced) {
      expect(text).toMatch(new RegExp(`\\${ref} \\d+ 0 R`));
    }
  });

  it("draws every mono line in a Courier face and no other line in one", () => {
    // THE PROPERTY. Character padding only aligns in a fixed-advance font, so a
    // `mono` line drawn in Helvetica is a valid PDF with a visibly ragged table.
    // Pair each drawn string with the face in force when it was drawn, rather
    // than just asserting both Courier resources appear somewhere.
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(
      decode(buildPdf(DOC)),
    )![1];
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
    // Both Courier faces are exercised above: one bold header, one regular row.
    expect(new Set(drawn.map((d) => d.font))).toEqual(
      new Set(["F1", "F2", "F3", "F4"]),
    );
  });

  it("publishes metrics a caller can bound its columns against", () => {
    expect(PDF_METRICS.monoAdvance).toBeCloseTo(0.6);
    expect(PDF_METRICS.drawableWidth).toBeGreaterThan(0);
    // The bound callers actually compute: chars that fit at a given point size.
    const charsAt9pt = Math.floor(
      PDF_METRICS.drawableWidth / (9 * PDF_METRICS.monoAdvance),
    );
    expect(charsAt9pt).toBeGreaterThan(40);
  });
});
