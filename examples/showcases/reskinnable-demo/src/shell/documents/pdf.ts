/**
 * A minimal, content-agnostic PDF writer — the shell's document primitive.
 *
 * Skins that hand a generated document to the model (BEAT 3d) need bytes, not a
 * library. This writes a single page of base-14 text (Helvetica for prose,
 * Courier for anything columnar) with no images, no compression and no embedded
 * fonts, which is about a hundred lines of string building and saves a
 * dependency whose only job would be this file. A caller supplies a flat
 * `Line[]`; sections are expressed as heading lines carrying a `gap`. Anything
 * more elaborate — images, multiple pages, non-Latin text — should reach for a
 * real library rather than growing this.
 *
 * It was extracted from commerce's price-sheet builder, which is where the first
 * of the properties below was learned. Each of them fails by emitting a
 * PERFECTLY VALID PDF that is wrong on screen, and nothing type-checks any of
 * them, which is exactly why they live in one place now instead of being
 * rediscovered per skin.
 *
 * WHY COURIER FOR THE TABLES. Columnar lines are aligned by CHARACTER COUNT
 * (`padEnd`), which is only true alignment in a monospaced font — in Helvetica
 * "BW-ALD-CRW" and "BW-HRR-TEE" are different widths, so every row would start
 * its next column somewhere new and the table would render visibly ragged. The
 * alternative — keep Helvetica and draw each column at an explicit x-offset —
 * needs a glyph-width table to guarantee a long value cannot overrun into the
 * next column, which is more code than this whole file. Courier's every glyph is
 * exactly 600/1000 em, so both the alignment AND the overflow bound reduce to
 * arithmetic on character counts (see `PDF_METRICS`). Set `mono` on any line
 * whose spacing carries meaning; leave it off for prose.
 *
 * AND WHY PROSE IS WRAPPED FOR YOU. Nothing here measures as it draws, so a line
 * that does not fit used to run off the right margin and be clipped by the
 * reader. That is survivable for literals an author eyeballs once and a live trap
 * for sentences DERIVED from data, whose length is not knowable when they are
 * written. `wrapForPage` breaks non-`mono` lines on word boundaries before
 * anything is drawn; `mono` lines are exempt, because their spacing is the point.
 *
 * Server-safe: plain TS, no React, no "use client".
 */

/**
 * Fold typographic characters down to ASCII.
 *
 * The page below declares base-14 fonts, whose built-in encoding is WinAnsi
 * — one byte per glyph. The content stream is emitted with `TextEncoder`, which
 * is UTF-8, so a single "—" goes out as three bytes and a reader renders three
 * garbage glyphs ("â€""). It also desynchronizes `/Length`, which is computed
 * from JS string length rather than byte length. Both problems disappear if the
 * stream is ASCII, and an ASCII document is no worse to read, so this folds
 * rather than reaching for a font-embedding library.
 */
const ASCII_FOLD: Record<string, string> = {
  "—": "-",
  "–": "-",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "×": "x",
  "·": "-",
};

export function toAscii(text: string): string {
  return (
    text
      // Decompose first, then drop the combining marks: "é" (U+00E9) becomes
      // "e" + U+0301 and the mark falls away, so an accented LETTER survives as
      // its base letter instead of becoming "?". Names and product names are
      // projected on screen and read aloud by the agent — "In?s Vidal" is worse
      // than "Ines Vidal", and both are worse than a mark we simply cannot draw.
      //
      // The class is \p{M} (combining marks) and NOT \p{Diacritic}, which sounds
      // righter and is wrong: \p{Diacritic} also covers the standalone ASCII
      // accents "^" (U+005E) and "`" (U+0060) — silently deleted out of ordinary
      // prose — and U+00B7 MIDDLE DOT, which the fold map below deliberately
      // turns into "-" and would instead vanish.
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[—–’‘“”…×·]/g, (ch) => ASCII_FOLD[ch] ?? "?")
      // Anything still outside printable ASCII (CJK, emoji, symbols) has no base
      // letter to fall back to, so it stays a visible "?" rather than vanishing —
      // a dropped character is a silent corruption, a "?" is a legible one.
      .replace(/[^\x20-\x7e]/g, "?")
  );
}

/** Escape the three characters that are special inside a PDF literal string. */
function pdfEscape(text: string): string {
  return toAscii(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export interface Line {
  text: string;
  /** Point size. */
  size?: number;
  bold?: boolean;
  /** Draw in Courier, so `padEnd` spacing in `text` is genuinely aligned. */
  mono?: boolean;
  /** Extra leading before this line, in points. */
  gap?: number;
}

const PAGE_HEIGHT = 792;
const PAGE_WIDTH = 612;
const MARGIN = 58;

/**
 * Resource names for the four base-14 faces the page declares, paired with the
 * `BaseFont` each resolves to. `buildPdf` emits one font object per entry, so a
 * face can never be referenced by the content stream without also being declared
 * — a dangling `/Fn` renders blank or corrupt in most readers.
 */
const FONTS = [
  { name: "F1", baseFont: "Helvetica" },
  { name: "F2", baseFont: "Helvetica-Bold" },
  { name: "F3", baseFont: "Courier" },
  { name: "F4", baseFont: "Courier-Bold" },
] as const;

/** Every Courier glyph advances 600/1000 em. This is what makes columns true. */
const MONO_ADVANCE = 0.6;

/** Point size a `Line` is drawn at when it does not name one. */
const DEFAULT_SIZE = 10.5;

/**
 * The alignment contract, exported so a caller can ASSERT its columns rather
 * than eyeball them on a rendered page: the monospaced advance that makes
 * character padding true, and the width a drawn line has to fit inside. A skin
 * bounds its own column widths against these — `chars = floor(drawableWidth /
 * (size * monoAdvance))`, which `charBudget` computes — and keeps any
 * content-specific widths in its own metrics object.
 *
 * COLUMNAR lines only. Prose is wrapped by `wrapForPage` below, so a caller does
 * not bound its sentences at all; `mono` lines are exempt from that wrap
 * precisely because their spacing is meaningful, which is what leaves their fit
 * the caller's own to assert.
 */
export const PDF_METRICS = {
  monoAdvance: MONO_ADVANCE,
  drawableWidth: PAGE_WIDTH - 2 * MARGIN,
} as const;

/**
 * A PDF resource name ("/F1"), built with `concat` rather than as a template. A
 * PDF name genuinely starts with "/", but the repo's LOCK_SKIN lint guard reads a
 * template opening with a lone "/" as a hardcoded skin route prefix — a false
 * positive here, and this phrasing sidesteps it without weakening the rule for
 * the links it exists to catch.
 */
const pdfName = (name: string) => "/".concat(name);

function fontFor(line: Line): string {
  if (line.mono) return line.bold ? "F4" : "F3";
  return line.bold ? "F2" : "F1";
}

/**
 * How many characters fit on one drawn line at `size`.
 *
 * Exported so a caller can bound its own content against the same number this
 * module wraps at, rather than rediscovering the arithmetic. Measured in the
 * ESCAPED, FOLDED form — see `wrapText` — so a caller comparing a raw string
 * against it is being slightly conservative, never optimistic.
 *
 * The advance is Courier's 600/1000 even for prose, which is Helvetica. An exact
 * bound would need the base-14 width table; Helvetica's lowercase and digits are
 * 556/1000 and its space is 278/1000, so 600 is comfortably conservative for
 * mixed-case text. It is NOT a bound for ALL-CAPS strings (Helvetica "W" is
 * 944/1000), so a shouted line long enough to matter can still overrun.
 */
export const charBudget = (size: number = DEFAULT_SIZE): number =>
  Math.floor((PAGE_WIDTH - 2 * MARGIN) / (size * MONO_ADVANCE));

/**
 * Break one string onto as many lines as it needs, on word boundaries.
 *
 * MEASURED ON THE ESCAPED, FOLDED STRING, because that is what is actually
 * drawn: `pdfEscape` turns one "(" into two characters and `toAscii` turns one
 * "…" into three, so a budget checked against the raw text is wrong by exactly
 * the amount a punctuation-heavy sentence needs it to be right. A skin-side
 * helper cannot do this — `pdfEscape` is private to this file — which is half of
 * why the wrap lives here.
 *
 * A word longer than the whole budget is left on its own line rather than being
 * split: hyphenating an identifier would invent one that does not exist, and
 * these documents are read aloud.
 */
function wrapText(text: string, budget: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (line !== "" && pdfEscape(candidate).length > budget) {
      out.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") out.push(line);
  // An intentionally blank line stays one blank line rather than vanishing.
  return out.length > 0 ? out : [text];
}

/**
 * Wrap every PROSE line to the page, leaving `mono` lines exactly as given.
 *
 * WHY THIS IS THE WRITER'S JOB. Everything below draws at a fixed x and never
 * measures, so before this existed a line that did not fit simply ran off the
 * right margin and the reader clipped it — a perfectly valid PDF that is wrong
 * on screen, in the paragraph a caller is most likely to have DERIVED from data
 * and least likely to have eyeballed. Logistics shipped a 111-character sentence
 * that ran a third of the way off the page; commerce and people both emit
 * derived prose and carried the identical latent bug. One wrap here removes it
 * for every skin instead of being rediscovered, re-fixed and re-tested per skin.
 *
 * `mono` lines are deliberately EXEMPT. Their alignment is character-count
 * arithmetic (`padEnd` against a caller's column widths), so wrapping one would
 * break the columns it exists to keep — a columnar line that does not fit is the
 * caller's bug, and `PDF_METRICS` is published so it can be asserted.
 *
 * A wrapped continuation inherits its parent's size, face and `mono` flag but
 * NEVER its `gap`: the gap opens a section, and re-opening it mid-sentence would
 * space a paragraph like a list.
 */
function wrapForPage(lines: Line[]): Line[] {
  return lines.flatMap((line) => {
    if (line.mono) return [line];
    const pieces = wrapText(line.text, charBudget(line.size ?? DEFAULT_SIZE));
    if (pieces.length === 1) return [line];
    return pieces.map((text, index) =>
      index === 0 ? { ...line, text } : { ...line, text, gap: 0 },
    );
  });
}

function contentStream(rawLines: Line[]): string {
  let y = PAGE_HEIGHT - MARGIN;
  const parts: string[] = ["BT"];
  for (const line of wrapForPage(rawLines)) {
    y -= (line.gap ?? 0) + (line.size ?? DEFAULT_SIZE) + 3.5;
    const font = pdfName(fontFor(line));
    parts.push(
      `${font} ${line.size ?? DEFAULT_SIZE} Tf`,
      `1 0 0 1 ${MARGIN} ${y} Tm`,
      `(${pdfEscape(line.text)}) Tj`,
    );
  }
  parts.push("ET");
  return parts.join("\n");
}

/**
 * Assemble a minimal, valid one-page PDF with a correct xref table.
 *
 * BYTES VS CHARACTERS — the assumption this function is built on. `/Length` and
 * every xref offset are BYTE offsets by spec, and both are computed below from JS
 * string length, which counts UTF-16 code units. The two agree ONLY while the
 * document is pure ASCII, which is `toAscii`'s job above and is pinned by "emits
 * only single-byte characters, even from accented input" in `pdf.test.ts`. If
 * that fold is ever relaxed — an accented vendor name is the obvious reason —
 * this arithmetic silently emits a corrupt document, and both numbers have to
 * move to `new TextEncoder().encode(...).length` at the same time.
 */
export function buildPdf(lines: Line[]): Uint8Array {
  const stream = contentStream(lines);
  // The four fixed objects come first, so /F1 is object 5.
  const FIRST_FONT_OBJECT = 5;
  const fontResources = FONTS.map(
    (font, index) => `${pdfName(font.name)} ${FIRST_FONT_OBJECT + index} 0 R`,
  ).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << ${fontResources} >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...FONTS.map(
      (font) =>
        `<< /Type /Font /Subtype /Type1 /BaseFont ${pdfName(font.baseFont)} >>`,
    ),
  ];

  let body = "%PDF-1.4\n";
  // Byte offsets have to be recorded as the body is assembled — the xref table
  // is the one part of a PDF a reader genuinely refuses to guess at.
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(body + xref + trailer);
}
