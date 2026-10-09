/**
 * Lay a parsed spreadsheet out as a document the model can read.
 *
 * ── WHY A TABLE AND NOT CSV ─────────────────────────────────────────────────
 * The obvious flattening is "join the cells with commas", and it is measurably
 * the worst of the options. Comparing table encodings on retrieval accuracy,
 * CSV lands around 44% while a column-aligned markdown-style table lands around
 * 52% — the header stops being a row the model has to count commas back to, and
 * starts being a label sitting directly above its value. Key-value does better
 * still (~61%) but costs ~2.7x the tokens and stops looking like a spreadsheet,
 * which matters here because the same document is shown on screen.
 *
 * So: one aligned table per sheet, header row separated by a rule, drawn in
 * Courier via `mono` so `padEnd` is true alignment rather than approximately
 * true. That is the same reason the price sheet uses Courier — see `pdf.ts`.
 *
 * ── WHAT IS DELIBERATELY LOSSY ──────────────────────────────────────────────
 * Column widths are bounded by the page, so a cell wider than its share is
 * truncated with a marker. That is a real loss of data and it is preferred to
 * the alternatives: wrapping breaks the alignment the format depends on, and
 * letting it run draws off the page where the reader clips it invisibly. The
 * truncation marker is what makes the loss legible to whoever reads the page —
 * and the count of truncated cells is reported to the caller so it can say so
 * out loud rather than leaving the model to answer off a clipped value.
 */

import { buildPdf, charBudget, toAscii } from "./pdf";
import type { Line } from "./pdf";
import type { SheetTable } from "./spreadsheet";

/** Point size for table rows. Small enough for ~10 columns of real data. */
const TABLE_SIZE = 7.5;
/** Two spaces between columns — enough to read as a gutter in a monospaced face. */
const GUTTER = "  ";
/** A column narrower than this cannot hold a value AND its truncation marker. */
const MIN_COLUMN = 4;
/** Marker left in a cell that did not fit, chosen to survive `toAscii`. */
const TRUNCATION_MARK = "~";

export interface SpreadsheetDocument {
  bytes: Uint8Array;
  /** How many cells were truncated to fit the page. Zero on a clean render. */
  truncatedCells: number;
  /** Total data rows across every sheet, for the caller's summary line. */
  totalRows: number;
}

/**
 * Trim a cell to `width`, marking it when something was removed.
 *
 * Measured after `toAscii`, because that is the string that actually gets drawn:
 * an em dash folds to one character but "…" folds to three, so a budget checked
 * against the raw text is wrong by exactly the amount a punctuation-heavy cell
 * needs it to be right.
 */
function fit(value: string, width: number): { text: string; cut: boolean } {
  const ascii = toAscii(value).replace(/\s+/g, " ").trim();
  if (ascii.length <= width) return { text: ascii.padEnd(width), cut: false };
  return {
    text: ascii.slice(0, Math.max(0, width - 1)) + TRUNCATION_MARK,
    cut: true,
  };
}

/**
 * Share the drawable width out across columns.
 *
 * Every column first gets what its widest cell needs. If that overruns the page,
 * the surplus is taken from the WIDEST columns first (repeatedly shaving the
 * current widest by one) rather than scaling everything down proportionally: a
 * sheet is usually a few narrow key columns beside one long description, and
 * proportional scaling mangles the short ones — which carry the identifiers —
 * to save a description that is going to be truncated regardless.
 */
function columnWidths(rows: string[][], budget: number): number[] {
  const count = Math.max(...rows.map((row) => row.length), 0);
  if (count === 0) return [];

  const widths = Array.from({ length: count }, (_, column) =>
    Math.max(1, ...rows.map((row) => toAscii(row[column] ?? "").trim().length)),
  );

  const gutters = GUTTER.length * (count - 1);
  const available = Math.max(count * MIN_COLUMN, budget - gutters);

  let total = widths.reduce((sum, width) => sum + width, 0);
  while (total > available) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest]! <= MIN_COLUMN) break;
    widths[widest]!--;
    total--;
  }
  return widths;
}

/**
 * Render one sheet as heading + aligned rows.
 *
 * The first row is treated as the header — true for essentially every sheet a
 * person hands over, and the failure mode when it is wrong is cosmetic (a data
 * row drawn bold above a rule) rather than a misread value.
 */
function sheetLines(
  sheet: SheetTable,
  showSheetName: boolean,
): { lines: Line[]; cut: number } {
  const lines: Line[] = [];
  let cut = 0;

  if (showSheetName) {
    lines.push({ text: sheet.name, size: 11, bold: true, gap: 14 });
  }

  const widths = columnWidths(sheet.rows, charBudget(TABLE_SIZE));
  if (widths.length === 0) {
    lines.push({ text: "(empty sheet)", size: TABLE_SIZE, gap: 4 });
    return { lines, cut };
  }

  const render = (row: string[]): string =>
    widths
      .map((width, column) => {
        const cell = fit(row[column] ?? "", width);
        if (cell.cut) cut++;
        return cell.text;
      })
      .join(GUTTER)
      // Trailing padding on the last column is invisible but inflates the
      // content stream on every row, so it is dropped.
      .trimEnd();

  const [header, ...body] = sheet.rows;
  if (header) {
    lines.push({
      text: render(header),
      size: TABLE_SIZE,
      mono: true,
      bold: true,
      gap: 6,
    });
    lines.push({
      text: widths.map((width) => "-".repeat(width)).join(GUTTER),
      size: TABLE_SIZE,
      mono: true,
    });
  }
  for (const row of body) {
    lines.push({ text: render(row), size: TABLE_SIZE, mono: true });
  }

  return { lines, cut };
}

/**
 * Build the document a spreadsheet attachment is delivered as.
 *
 * The heading names the ORIGINAL file, so the page the model reads and the chip
 * the presenter sees in the transcript agree on what this document is. Without
 * it the model has a nameless table and tends to describe it as "the attached
 * document" when asked about "the spreadsheet".
 */
export function buildSpreadsheetPdf(
  filename: string,
  sheets: SheetTable[],
): SpreadsheetDocument {
  const lines: Line[] = [
    { text: filename, size: 15, bold: true },
    {
      text:
        sheets.length === 1
          ? `Spreadsheet - ${sheets[0]!.rows.length} rows`
          : `Spreadsheet - ${sheets.length} sheets`,
      size: 9,
      gap: 2,
    },
  ];

  let truncatedCells = 0;
  let totalRows = 0;

  for (const sheet of sheets) {
    // A single-sheet workbook does not need its sheet name announced — it is
    // almost always "Sheet1", which tells a reader nothing the heading has not.
    const rendered = sheetLines(sheet, sheets.length > 1);
    lines.push(...rendered.lines);
    truncatedCells += rendered.cut;
    totalRows += sheet.rows.length;
  }

  if (truncatedCells > 0) {
    lines.push({
      text:
        `Note: ${truncatedCells} cell(s) were too wide for the page and are ` +
        `truncated, marked with "${TRUNCATION_MARK}".`,
      size: 8,
      gap: 12,
    });
  }

  return { bytes: buildPdf(lines), truncatedCells, totalRows };
}
