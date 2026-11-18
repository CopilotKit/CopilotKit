/**
 * Read a spreadsheet the presenter drops into the composer — .xlsx or .csv —
 * into plain rows the document writer can lay out.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * OpenAI's Responses API *does* ingest .xlsx natively (it parses the first ~1000
 * rows per sheet and attaches generated header/summary metadata), and the
 * runtime's `openai(model)` already resolves to the Responses model. The block
 * is one layer above that: `@ai-sdk/openai@3` — the version this app is pinned
 * to through the CopilotKit canary line — whitelists `image/*` and
 * `application/pdf` in its file-part converter and throws
 * `UnsupportedFunctionalityError` on anything else, before a request is ever
 * made. `@ai-sdk/openai@4` added a `passThroughUnsupportedFiles` provider option
 * for exactly this case.
 *
 * So the REAL fix is a v4 bump plus the runtime forwarding that option, and this
 * module is the same-day stand-in: parse the sheet here, render it as a document
 * the pinned converter already accepts. Delete it when the bump lands.
 *
 * ── WHY NO DEPENDENCY ───────────────────────────────────────────────────────
 * SheetJS's npm build is frozen at a release carrying known advisories, and
 * pulling a full workbook library to read cell text into a table is the same
 * trade this folder already declined for PDF writing. An .xlsx is a ZIP of XML;
 * the browser ships both a ZIP-grade inflater (`DecompressionStream`) and an XML
 * parser (`DOMParser`), so the whole reader is arithmetic over those two.
 *
 * What it deliberately does NOT do: formulas (the cached value is read instead),
 * merged-cell geometry, styling, charts, or pivot tables. A spreadsheet is being
 * flattened to text for a language model, and none of those survive that anyway.
 *
 * Browser-only: `DecompressionStream` and `DOMParser` are both DOM APIs. This
 * module is imported from the client attachment path and must never be pulled
 * into a server component.
 */

/** One sheet, flattened to text. `rows[0]` is whatever the sheet's first row is. */
export interface SheetTable {
  name: string;
  rows: string[][];
}

/**
 * Spreadsheet MIME types and extensions the composer accepts.
 *
 * Extensions are checked ALONGSIDE MIME types because the browser's `file.type`
 * for a spreadsheet is unreliable: it is empty for a file dragged from some
 * archive tools, and Windows reports `application/vnd.ms-excel` for a modern
 * .xlsx often enough to matter. The extension is the thing the presenter can
 * actually see, so it is the tiebreak.
 */
const XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

const CSV_MIME_TYPES = new Set(["text/csv", "text/tab-separated-values"]);

const XLSX_EXTENSIONS = [".xlsx", ".xlsm", ".xls"];
const CSV_EXTENSIONS = [".csv", ".tsv"];

const hasExtension = (name: string, extensions: string[]): boolean =>
  extensions.some((extension) => name.toLowerCase().endsWith(extension));

export type SpreadsheetKind = "xlsx" | "csv";

/**
 * Which reader (if any) claims this file. Returning the KIND rather than a
 * boolean is what lets the caller branch without re-deriving the same guesses.
 */
export function spreadsheetKind(file: {
  name: string;
  type: string;
}): SpreadsheetKind | null {
  if (
    XLSX_MIME_TYPES.has(file.type) ||
    hasExtension(file.name, XLSX_EXTENSIONS)
  )
    return "xlsx";
  if (CSV_MIME_TYPES.has(file.type) || hasExtension(file.name, CSV_EXTENSIONS))
    return "csv";
  return null;
}

/**
 * Thrown for every readable-file-that-is-not-readable case, so the caller has
 * exactly one thing to catch and one message to show a presenter mid-demo.
 */
export class SpreadsheetReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetReadError";
  }
}

// ── ZIP ─────────────────────────────────────────────────────────────────────

/**
 * One ZIP member: its raw bytes, and whether they still need inflating.
 *
 * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: since TS 5.7 the
 * default parameter is `ArrayBufferLike`, which admits `SharedArrayBuffer` and
 * is therefore not a valid `BufferSource` for the stream writer below. The same
 * pin is documented in `shell/attach/stage-attachment.ts`.
 */
interface ZipEntry {
  data: Uint8Array<ArrayBuffer>;
  deflated: boolean;
}

/**
 * Read the entries of a ZIP archive.
 *
 * Driven from the END of the file (the central directory) rather than by walking
 * local headers forward, because a local header's size fields are allowed to be
 * zero when a streaming writer sets bit 3 of the general-purpose flags and defers
 * the sizes to a trailing data descriptor. Excel does not do that today, but
 * plenty of xlsx-producing tools do, and a forward walk silently reads zero bytes
 * for those entries — an empty sheet rather than an error.
 */
function readZip(bytes: Uint8Array<ArrayBuffer>): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The End Of Central Directory record is the last thing in the file, but it
  // ends in a variable-length comment, so it has to be found by scanning back
  // for its signature. 22 bytes is its fixed size; a comment can be 64KB.
  const EOCD_SIGNATURE = 0x06054b50;
  const EOCD_MIN_SIZE = 22;
  let eocd = -1;
  const scanFloor = Math.max(0, bytes.length - EOCD_MIN_SIZE - 0xffff);
  for (let i = bytes.length - EOCD_MIN_SIZE; i >= scanFloor; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new SpreadsheetReadError(
      "the file is not a readable .xlsx workbook (no ZIP directory found)",
    );
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries = new Map<string, ZipEntry>();
  const CENTRAL_SIGNATURE = 0x02014b50;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > bytes.length) break;
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );

    // The local header repeats the name and extra fields at its own lengths,
    // which are NOT required to match the central directory's — so the data
    // offset has to be computed from the local header, never from the central one.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);

    // 0 = stored, 8 = deflate. Anything else (bzip2, LZMA) is not something
    // Excel emits, and guessing would corrupt the sheet rather than fail.
    if (method === 0 || method === 8) {
      entries.set(name, { data, deflated: method === 8 });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Inflate one entry if it was deflated, using the browser's own inflater. */
async function entryText(
  entries: Map<string, ZipEntry>,
  name: string,
): Promise<string> {
  const entry = entries.get(name);
  if (!entry) return "";
  if (!entry.deflated) return new TextDecoder().decode(entry.data);

  // "deflate-raw" (not "deflate") — a ZIP member carries a bare deflate stream
  // with no zlib header, and the zlib decoder rejects it outright.
  //
  // Driven through the raw writer/reader pair rather than `new Blob().stream()`
  // or `new Response(stream)`, because those two are the parts of the platform
  // that vary: jsdom's Blob has no `stream()`, and undici's Response does not
  // accept one as a body. `DecompressionStream` plus the streams API is present
  // and identical in every browser and in Node, so this path is the same code
  // under test as in production.
  const inflate = new DecompressionStream("deflate-raw");
  const writer = inflate.writable.getWriter();
  // Deliberately NOT awaited: the stream only drains as it is read, so awaiting
  // the write before reading deadlocks on anything past the internal buffer.
  const written = writer
    .write(entry.data)
    .then(() => writer.close())
    .catch(() => undefined);

  const reader = inflate.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await written;

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(out);
}

// ── XLSX ────────────────────────────────────────────────────────────────────

/** Parse an XML document, failing loudly rather than returning a parsererror tree. */
function parseXml(xml: string, what: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new SpreadsheetReadError(`the workbook's ${what} is malformed XML`);
  }
  return doc;
}

/**
 * "BC" → 54. Column letters are base-26 with no zero, so 'A' is 1 rather than 0
 * and the usual `charCodeAt - 65` is off by one at every place value.
 */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

/**
 * Excel stores a date as a day count and leaves its DATE-ness in the cell's
 * number format, so a sheet read without consulting styles.xml shows "45231"
 * where the presenter sees "2023-11-14". On a projector that reads as the
 * product mangling their data.
 *
 * The epoch is 1899-12-30, not 1900-01-01: Excel deliberately reproduces a Lotus
 * 1-2-3 bug that treats 1900 as a leap year, so every serial is two days off a
 * naive epoch (one for the phantom 29 Feb 1900, one for counting from 1).
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function serialToDate(serial: number): string {
  const date = new Date(EXCEL_EPOCH_MS + Math.round(serial) * DAY_MS);
  return date.toISOString().slice(0, 10);
}

/** Built-in number-format ids that mean "date" or "date-time" (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47,
]);

/**
 * Which cell-format indexes render as dates.
 *
 * A custom format is a date format when its code contains a date token outside a
 * literal. The `[$-409]` locale prefix and quoted literals are stripped first,
 * because both routinely contain letters that would otherwise read as tokens —
 * `"May"` in a literal being the obvious one.
 */
function dateFormatIndexes(stylesXml: string): Set<number> {
  if (!stylesXml) return new Set();
  const styles = parseXml(stylesXml, "styles.xml");

  const customDateIds = new Set<number>();
  for (const numFmt of styles.querySelectorAll("numFmt")) {
    const id = Number(numFmt.getAttribute("numFmtId"));
    const code = (numFmt.getAttribute("formatCode") ?? "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/"[^"]*"/g, "");
    // `m` is minutes when it follows `h`, but a format containing y or d is a
    // date regardless, and one containing only `m` is a month format in practice.
    if (/[yd]/i.test(code) || (/m/i.test(code) && !/[hs]/i.test(code))) {
      customDateIds.add(id);
    }
  }

  const indexes = new Set<number>();
  const cellXfs = styles.querySelector("cellXfs");
  if (!cellXfs) return indexes;
  [...cellXfs.querySelectorAll("xf")].forEach((xf, index) => {
    const id = Number(xf.getAttribute("numFmtId") ?? "0");
    if (BUILTIN_DATE_FORMATS.has(id) || customDateIds.has(id))
      indexes.add(index);
  });
  return indexes;
}

/** The shared-string table, resolved to plain text (runs concatenated). */
function sharedStrings(xml: string): string[] {
  if (!xml) return [];
  const doc = parseXml(xml, "sharedStrings.xml");
  return [...doc.querySelectorAll("si")].map((si) =>
    [...si.querySelectorAll("t")].map((t) => t.textContent ?? "").join(""),
  );
}

/** The sheets, in workbook order, paired with the part that holds each one. */
function sheetParts(
  workbookXml: string,
  relsXml: string,
): { name: string; path: string }[] {
  const workbook = parseXml(workbookXml, "workbook.xml");
  const rels = relsXml ? parseXml(relsXml, "workbook.xml.rels") : null;

  const targets = new Map<string, string>();
  for (const rel of rels?.querySelectorAll("Relationship") ?? []) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, ""));
  }

  return [...workbook.querySelectorAll("sheet")].map((sheet, index) => {
    // The r:id attribute is namespaced; getAttribute with the bare local name
    // misses it in an XML document, so both spellings are tried.
    const relId =
      sheet.getAttribute("r:id") ??
      sheet.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      );
    const target = relId ? targets.get(relId) : undefined;
    return {
      name: sheet.getAttribute("name") ?? `Sheet${index + 1}`,
      // The relationship is authoritative; the positional guess is the fallback
      // for a workbook whose rels part is missing or unreadable.
      path: `xl/${target ?? `worksheets/sheet${index + 1}.xml`}`,
    };
  });
}

/** One worksheet's cells, as a dense row/column grid of display text. */
function sheetRows(
  xml: string,
  strings: string[],
  dateStyles: Set<number>,
): string[][] {
  const doc = parseXml(xml, "a worksheet");
  const rows: string[][] = [];

  for (const row of doc.querySelectorAll("row")) {
    const cells: string[] = [];
    for (const cell of row.querySelectorAll("c")) {
      const ref = cell.getAttribute("r") ?? "";
      const index = ref ? columnIndex(ref) : cells.length;
      const type = cell.getAttribute("t");

      let text = "";
      if (type === "inlineStr") {
        text = [...cell.querySelectorAll("is t")]
          .map((t) => t.textContent ?? "")
          .join("");
      } else {
        // `v` is the cached value. For a formula cell that is exactly what we
        // want — the number Excel last computed, not the expression.
        const raw = cell.querySelector("v")?.textContent ?? "";
        if (type === "s") {
          text = strings[Number(raw)] ?? "";
        } else if (type === "b") {
          text = raw === "1" ? "TRUE" : "FALSE";
        } else if (raw !== "") {
          const styleIndex = Number(cell.getAttribute("s") ?? "-1");
          const numeric = Number(raw);
          text =
            dateStyles.has(styleIndex) &&
            Number.isFinite(numeric) &&
            numeric > 0
              ? serialToDate(numeric)
              : raw;
        }
      }

      // Excel omits empty cells entirely, so the grid is filled by column index
      // rather than by append — otherwise a gap shifts every later column left
      // and silently re-associates values with the wrong headers.
      while (cells.length < index) cells.push("");
      cells[index] = text;
    }
    rows.push(cells);
  }

  return rows;
}

async function readXlsx(bytes: Uint8Array<ArrayBuffer>): Promise<SheetTable[]> {
  if (typeof DecompressionStream === "undefined") {
    throw new SpreadsheetReadError(
      "this browser cannot decompress .xlsx files (no DecompressionStream)",
    );
  }

  const entries = readZip(bytes);

  const [workbookXml, relsXml, stringsXml, stylesXml] = await Promise.all([
    entryText(entries, "xl/workbook.xml"),
    entryText(entries, "xl/_rels/workbook.xml.rels"),
    entryText(entries, "xl/sharedStrings.xml"),
    entryText(entries, "xl/styles.xml"),
  ]);

  if (!workbookXml) {
    throw new SpreadsheetReadError(
      "the file is not a readable .xlsx workbook (no xl/workbook.xml inside)",
    );
  }

  const strings = sharedStrings(stringsXml);
  const dateStyles = dateFormatIndexes(stylesXml);

  const sheets: SheetTable[] = [];
  for (const { name, path } of sheetParts(workbookXml, relsXml)) {
    const xml = await entryText(entries, path);
    if (!xml) continue;
    sheets.push({ name, rows: sheetRows(xml, strings, dateStyles) });
  }
  return sheets;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * RFC 4180 with the two concessions every real-world file needs: CRLF or LF, and
 * a doubled quote inside a quoted field. Written as a character walk rather than
 * a split, because a comma or newline inside quotes is the whole point and no
 * regex split survives it.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  // A file not ending in a newline still has one final row to flush; one that
  // does must not gain a spurious empty row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Read a spreadsheet file into sheets.
 *
 * Throws `SpreadsheetReadError` with a presenter-readable reason rather than
 * returning empty rows: an empty table would be rendered, attached and answered
 * off, and the model would describe a document with no data in it as though that
 * were the truth.
 */
export async function readSpreadsheet(file: File): Promise<SheetTable[]> {
  const kind = spreadsheetKind(file);

  if (kind === "csv") {
    const text = await file.text();
    const delimiter = file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    const rows = parseCsv(text, delimiter);
    if (rows.length === 0) {
      throw new SpreadsheetReadError("the file is empty");
    }
    return [{ name: file.name, rows }];
  }

  if (kind === "xlsx") {
    const sheets = await readXlsx(new Uint8Array(await file.arrayBuffer()));
    const withRows = sheets.filter((sheet) => sheet.rows.length > 0);
    if (withRows.length === 0) {
      throw new SpreadsheetReadError("the workbook has no rows in any sheet");
    }
    return withRows;
  }

  throw new SpreadsheetReadError(`${file.name} is not a spreadsheet`);
}
