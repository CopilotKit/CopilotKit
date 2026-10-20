/**
 * Generate `public/sample-q2-expenses.xlsx` — the workbook a presenter drops
 * into the composer to show multimodal ingest of a spreadsheet.
 *
 * Committed as a GENERATOR rather than as a binary blob for the same reason
 * commerce generates its price sheet: the file is a demo prop, and a prop nobody
 * can read the source of is a prop nobody can correct. It also means the fixture
 * exercises the real reader — shared strings, date-styled serials, a second
 * sheet, and deflate — rather than some simplified shape.
 *
 * Run: node scripts/make-sample-spreadsheet.mjs
 */

import { deflateRawSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "sample-q2-expenses.xlsx");

// ── the data ────────────────────────────────────────────────────────────────

/** Excel's day-count epoch. See `serialToDate` in shell/documents/spreadsheet.ts. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const serial = (iso) =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000);

const EXPENSES = [
  [
    "2026-04-02",
    "Meridian Creative",
    "Marketing",
    "A. Morgan",
    18400,
    "Approved",
  ],
  ["2026-04-05", "Cvent", "Events", "R. Okafor", 7800, "Approved"],
  ["2026-04-09", "Datadog", "Software", "T. Lindqvist", 4210.5, "Approved"],
  ["2026-04-14", "Delta Air Lines", "Travel", "A. Morgan", 1842.1, "Query"],
  ["2026-04-16", "Aurora Catering", "Events", "R. Okafor", 4045, "Approved"],
  ["2026-04-21", "Figma", "Software", "S. Adeyemi", 1188, "Approved"],
  ["2026-04-23", "The Copper Room", "Meals", "A. Morgan", 412.88, "Query"],
  ["2026-04-28", "Rideshare Co", "Travel", "T. Lindqvist", 31.7, "Approved"],
  [
    "2026-05-01",
    "Meridian Creative",
    "Marketing",
    "A. Morgan",
    12750,
    "Approved",
  ],
  ["2026-05-04", "AWS", "Infrastructure", "S. Adeyemi", 15000, "Escalated"],
  [
    "2026-05-07",
    "Northgate Pharmacy",
    "Personal",
    "R. Okafor",
    42.15,
    "Rejected",
  ],
  ["2026-05-11", "Ascend Air", "Travel", "A. Morgan", 842.1, "Approved"],
  ["2026-05-13", "Quill & Bindery", "Office", "T. Lindqvist", 56, "Rejected"],
  ["2026-05-18", "Google Ads", "Marketing", "S. Adeyemi", 9600, "Approved"],
  [
    "2026-05-22",
    "Streamly Monthly",
    "Personal",
    "A. Morgan",
    17.99,
    "Rejected",
  ],
  ["2026-05-26", "Sundry Wellness Co", "Wellness", "R. Okafor", 180, "Query"],
  ["2026-05-29", "Linear", "Software", "T. Lindqvist", 960, "Approved"],
  ["2026-06-02", "Marlowe's Tap House", "Meals", "A. Morgan", 88.3, "Rejected"],
  ["2026-06-05", "Meta Ads", "Marketing", "S. Adeyemi", 12750, "Approved"],
  ["2026-06-09", "WeWork", "Facilities", "R. Okafor", 6400, "Approved"],
  ["2026-06-12", "Ascend Air", "Travel", "T. Lindqvist", 1290.4, "Approved"],
  ["2026-06-15", "Notion", "Software", "A. Morgan", 720, "Approved"],
  ["2026-06-18", "Hertz", "Travel", "S. Adeyemi", 388.25, "Query"],
  ["2026-06-21", "Aurora Catering", "Events", "R. Okafor", 2310, "Approved"],
  [
    "2026-06-24",
    "Cloudflare",
    "Infrastructure",
    "T. Lindqvist",
    2400,
    "Approved",
  ],
  [
    "2026-06-27",
    "Meridian Creative",
    "Marketing",
    "A. Morgan",
    14250,
    "Escalated",
  ],
  ["2026-06-30", "Sundry Wellness Co", "Wellness", "S. Adeyemi", 220, "Query"],
];

const POLICY = [
  ["Category", "Per-item limit", "Requires receipt", "Owner"],
  ["Travel", 2000, "Yes", "Finance Ops"],
  ["Meals", 150, "Yes", "Finance Ops"],
  ["Software", 5000, "No", "IT"],
  ["Marketing", 20000, "Yes", "Growth"],
  ["Events", 10000, "Yes", "Growth"],
  ["Infrastructure", 25000, "No", "IT"],
  ["Facilities", 8000, "Yes", "Workplace"],
  ["Wellness", 250, "Yes", "People"],
  ["Office", 500, "Yes", "Workplace"],
  ["Personal", 0, "n/a", "Not reimbursable"],
];

const EXPENSE_HEADER = [
  "Date",
  "Vendor",
  "Category",
  "Employee",
  "Amount (USD)",
  "Status",
];

// ── xlsx writing ────────────────────────────────────────────────────────────

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Shared-string table, built as the sheets are emitted. */
const strings = [];
const stringIndex = new Map();
const internString = (value) => {
  if (!stringIndex.has(value)) {
    stringIndex.set(value, strings.length);
    strings.push(value);
  }
  return stringIndex.get(value);
};

const columnName = (index) => {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};

/**
 * `style` indexes into cellXfs below: 0 plain, 1 bold header, 2 date, 3 money.
 * A cell is emitted as a shared string unless it is a number.
 */
function cellXml(value, ref, style) {
  const attrs = `r="${ref}"${style ? ` s="${style}"` : ""}`;
  if (typeof value === "number") {
    return `<c ${attrs}><v>${value}</v></c>`;
  }
  return `<c ${attrs} t="s"><v>${internString(String(value))}</v></c>`;
}

function sheetXml(rows, styleFor) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) =>
          cellXml(
            value,
            `${columnName(columnIndex)}${rowIndex + 1}`,
            styleFor(rowIndex, columnIndex),
          ),
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const expenseRows = [
  EXPENSE_HEADER,
  ...EXPENSES.map(([date, ...rest]) => [serial(date), ...rest]),
];

const expensesSheet = sheetXml(expenseRows, (row, column) => {
  if (row === 0) return 1;
  if (column === 0) return 2;
  if (column === 4) return 3;
  return 0;
});

const policySheet = sheetXml(POLICY, (row) => (row === 0 ? 1 : 0));

const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
  .map((s) => `<si><t>${escapeXml(s)}</t></si>`)
  .join("")}</sst>`;

// numFmtId 14 is the built-in short date; 164 is a custom currency format. Both
// are what make the reader's date detection meaningful.
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="Q2 Expenses" sheetId="1" r:id="rId1"/>
<sheet name="Policy Limits" sheetId="2" r:id="rId2"/>
</sheets>
</workbook>`;

const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const FILES = [
  ["[Content_Types].xml", contentTypes],
  ["_rels/.rels", rootRels],
  ["xl/workbook.xml", workbookXml],
  ["xl/_rels/workbook.xml.rels", workbookRels],
  ["xl/sharedStrings.xml", sharedStringsXml],
  ["xl/styles.xml", stylesXml],
  ["xl/worksheets/sheet1.xml", expensesSheet],
  ["xl/worksheets/sheet2.xml", policySheet],
];

// ── ZIP writing ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of files) {
    const raw = Buffer.from(text, "utf8");
    const deflated = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x2199, 12); // date (a fixed 2026-12-25, so the file is reproducible)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBytes, deflated);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x2199, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, eocd]);
}

mkdirSync(dirname(OUT), { recursive: true });
const bytes = zip(FILES);
writeFileSync(OUT, bytes);
console.log(
  `wrote ${OUT} (${bytes.length} bytes, ${EXPENSES.length} expense rows, ${POLICY.length - 1} policy rows)`,
);
