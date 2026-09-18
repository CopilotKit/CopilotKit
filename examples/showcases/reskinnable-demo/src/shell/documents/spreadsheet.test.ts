/**
 * The spreadsheet reader's contract.
 *
 * Every case here is one where the reader could plausibly return SOMETHING
 * wrong rather than throw — a shifted column, a date shown as five digits, a
 * silently empty sheet. Those are the failures that matter, because the output
 * is handed to a model that will describe whatever it is given as fact.
 *
 * The .xlsx fixtures are built with the same generator that writes the demo
 * workbook, so the bytes under test are a real deflated OOXML package rather
 * than a hand-simplified stand-in.
 */

import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  parseCsv,
  readSpreadsheet,
  spreadsheetKind,
  SpreadsheetReadError,
} from "./spreadsheet";

// jsdom's Blob implements `text()` but not `arrayBuffer()`, and the reader needs
// the bytes. Both exist in every browser this ships to, so the gap is the test
// environment's rather than the source's — polyfilled here instead of routing
// production code around a missing DOM method.
//
// Via jsdom's own FileReader, NOT `new Response(blob)`: undici's Response does
// not recognise a jsdom Blob as a body and stringifies it, so every fixture
// arrives as the 15 bytes of "[object Blob]" and the ZIP scan fails on all of
// them identically — which reads as a broken reader rather than a broken
// harness.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// ── fixture helpers ─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a ZIP. `store` writes members uncompressed, to cover method 0. */
function zip(files: [string, string][], store = false): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, text] of files) {
    const raw = Buffer.from(text, "utf8");
    const body = store ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(store ? 0 : 8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...chunks, dir, eocd]));
}

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Expenses" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const RELS = `<?xml version="1.0"?>
<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0"?>
<styleSheet>
<numFmts><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>
<cellXfs count="3">
<xf numFmtId="0"/>
<xf numFmtId="14"/>
<xf numFmtId="164"/>
</cellXfs></styleSheet>`;

const SHARED = (values: string[]) =>
  `<?xml version="1.0"?><sst>${values.map((v) => `<si><t>${v}</t></si>`).join("")}</sst>`;

function xlsxFile(sheetXml: string, strings: string[] = []): File {
  const bytes = zip([
    ["xl/workbook.xml", WORKBOOK],
    ["xl/_rels/workbook.xml.rels", RELS],
    ["xl/styles.xml", STYLES],
    ["xl/sharedStrings.xml", SHARED(strings)],
    ["xl/worksheets/sheet1.xml", sheetXml],
  ]);
  return new File([bytes as BlobPart], "book.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const sheet = (rows: string) =>
  `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;

// ── kind detection ──────────────────────────────────────────────────────────

describe("spreadsheetKind", () => {
  it("claims a modern .xlsx by MIME type", () => {
    expect(
      spreadsheetKind({
        name: "q2.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe("xlsx");
  });

  it("claims a spreadsheet whose MIME type the browser did not set", () => {
    // Dragging out of some archive tools yields an empty `type`, which is
    // exactly the case that used to be dropped with no chip and no error.
    expect(spreadsheetKind({ name: "q2.xlsx", type: "" })).toBe("xlsx");
  });

  it("claims .csv and .tsv", () => {
    expect(spreadsheetKind({ name: "rows.csv", type: "" })).toBe("csv");
    expect(spreadsheetKind({ name: "rows.tsv", type: "" })).toBe("csv");
  });

  it("does not claim a PDF or an image", () => {
    expect(
      spreadsheetKind({ name: "a.pdf", type: "application/pdf" }),
    ).toBeNull();
    expect(spreadsheetKind({ name: "a.png", type: "image/png" })).toBeNull();
  });
});

// ── CSV ─────────────────────────────────────────────────────────────────────

describe("parseCsv", () => {
  it("keeps a delimiter that sits inside quotes", () => {
    expect(parseCsv('a,"b,c",d', ",")).toEqual([["a", "b,c", "d"]]);
  });

  it("keeps a newline that sits inside quotes", () => {
    expect(parseCsv('a,"line1\nline2",c', ",")).toEqual([
      ["a", "line1\nline2", "c"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('"say ""hi""",b', ",")).toEqual([['say "hi"', "b"]]);
  });

  it("handles CRLF without leaving carriage returns in the cells", () => {
    expect(parseCsv("a,b\r\nc,d\r\n", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("does not invent a trailing empty row for a file ending in a newline", () => {
    expect(parseCsv("a,b\n", ",")).toEqual([["a", "b"]]);
  });

  it("keeps the final row of a file that does not end in a newline", () => {
    expect(parseCsv("a,b\nc,d", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

// ── XLSX ────────────────────────────────────────────────────────────────────

describe("readSpreadsheet — xlsx", () => {
  it("resolves shared strings and reads inline numbers", async () => {
    const file = xlsxFile(
      sheet(
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
          `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250.5</v></c></row>`,
      ),
      ["Vendor", "Amount", "Datadog"],
    );
    const [table] = await readSpreadsheet(file);
    expect(table!.name).toBe("Expenses");
    expect(table!.rows).toEqual([
      ["Vendor", "Amount"],
      ["Datadog", "1250.5"],
    ]);
  });

  it("renders a date-styled serial as a date, not as five digits", async () => {
    // s="1" is numFmtId 14, the built-in short date. 46114 is 2026-04-02.
    const file = xlsxFile(
      sheet(`<row r="1"><c r="A1" s="1"><v>46114</v></c></row>`),
    );
    const [table] = await readSpreadsheet(file);
    expect(table!.rows[0]).toEqual(["2026-04-02"]);
  });

  it("leaves a plain number alone even when it could pass for a serial", async () => {
    // The same value with no date style is an amount, and rewriting it as a date
    // would silently corrupt every large figure on the sheet.
    const file = xlsxFile(
      sheet(`<row r="1"><c r="A1" s="2"><v>46114</v></c></row>`),
    );
    const [table] = await readSpreadsheet(file);
    expect(table!.rows[0]).toEqual(["46114"]);
  });

  it("preserves column position when Excel omits an empty cell", async () => {
    // Excel writes no <c> at all for a blank cell. Appending instead of placing
    // by column reference shifts every later value one column left, which
    // re-associates it with the wrong header and is invisible downstream.
    const file = xlsxFile(
      sheet(`<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>`),
    );
    const [table] = await readSpreadsheet(file);
    expect(table!.rows[0]).toEqual(["1", "", "3"]);
  });

  it("reads a column past Z, where the base-26 arithmetic goes wrong", async () => {
    const file = xlsxFile(sheet(`<row r="1"><c r="AA1"><v>27</v></c></row>`));
    const [table] = await readSpreadsheet(file);
    expect(table!.rows[0]).toHaveLength(27);
    expect(table!.rows[0]![26]).toBe("27");
  });

  it("reads an inline string", async () => {
    const file = xlsxFile(
      sheet(
        `<row r="1"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c></row>`,
      ),
    );
    const [table] = await readSpreadsheet(file);
    expect(table!.rows[0]).toEqual(["Hello"]);
  });

  it("reads a boolean as a word rather than as 0/1", async () => {
    const file = xlsxFile(
      sheet(
        `<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c></row>`,
      ),
    );
    const [table] = await readSpreadsheet(file);
    expect(table!.rows[0]).toEqual(["TRUE", "FALSE"]);
  });

  it("reads a formula cell's cached value rather than its expression", async () => {
    const file = xlsxFile(
      sheet(`<row r="1"><c r="A1"><f>SUM(B1:B9)</f><v>4045</v></c></row>`),
    );
    const [table] = await readSpreadsheet(file);
    expect(table!.rows[0]).toEqual(["4045"]);
  });

  it("reads members that were stored uncompressed", async () => {
    const bytes = zip(
      [
        ["xl/workbook.xml", WORKBOOK],
        ["xl/_rels/workbook.xml.rels", RELS],
        ["xl/styles.xml", STYLES],
        ["xl/sharedStrings.xml", SHARED([])],
        [
          "xl/worksheets/sheet1.xml",
          sheet(`<row r="1"><c r="A1"><v>7</v></c></row>`),
        ],
      ],
      true,
    );
    const file = new File([bytes as BlobPart], "stored.xlsx", { type: "" });
    const [table] = await readSpreadsheet(file);
    expect(table!.rows[0]).toEqual(["7"]);
  });

  it("throws rather than returning an empty table for a non-ZIP file", async () => {
    const file = new File(
      [new Uint8Array([1, 2, 3, 4]) as BlobPart],
      "fake.xlsx",
      {
        type: "",
      },
    );
    await expect(readSpreadsheet(file)).rejects.toBeInstanceOf(
      SpreadsheetReadError,
    );
  });

  it("throws rather than returning an empty table for a ZIP that is not a workbook", async () => {
    const bytes = zip([["hello.txt", "not a workbook"]]);
    const file = new File([bytes as BlobPart], "notes.xlsx", { type: "" });
    await expect(readSpreadsheet(file)).rejects.toBeInstanceOf(
      SpreadsheetReadError,
    );
  });

  it("throws when every sheet is empty, instead of attaching a blank document", async () => {
    const file = xlsxFile(sheet(""));
    await expect(readSpreadsheet(file)).rejects.toBeInstanceOf(
      SpreadsheetReadError,
    );
  });
});
