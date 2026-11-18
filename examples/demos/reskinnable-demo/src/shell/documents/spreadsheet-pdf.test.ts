/**
 * The spreadsheet renderer's contract, and the pagination it depends on.
 *
 * These assert on the emitted PDF's TEXT and STRUCTURE rather than on golden
 * bytes, because the property that matters is "every row the sheet had is on a
 * page somewhere" — the exact byte layout is free to change.
 */

import { describe, expect, it } from "vitest";
import { buildPdf } from "./pdf";
import { buildSpreadsheetPdf } from "./spreadsheet-pdf";
import type { SheetTable } from "./spreadsheet";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** `/Count N` in the Pages object is the page count the reader will honour. */
const pageCount = (pdf: string) => Number(pdf.match(/\/Count (\d+)/)![1]);

/** Every literal string drawn on the page, in order. */
const drawnText = (pdf: string) =>
  [...pdf.matchAll(/\((.*?)\) Tj/g)].map((match) => match[1]!);

describe("buildPdf pagination", () => {
  it("keeps a short document on one page", () => {
    const pdf = decode(buildPdf([{ text: "one line" }]));
    expect(pageCount(pdf)).toBe(1);
  });

  it("opens more pages rather than drawing past the bottom margin", () => {
    const pdf = decode(
      buildPdf(Array.from({ length: 200 }, (_, i) => ({ text: `row ${i}` }))),
    );
    expect(pageCount(pdf)).toBeGreaterThan(1);
  });

  it("draws every line it was given, across all pages", () => {
    // The failure this exists for: overflow used to be emitted at coordinates
    // below the page, producing a valid PDF that silently showed ~48 of 200 rows.
    const lines = Array.from({ length: 200 }, (_, i) => ({ text: `row ${i}` }));
    const pdf = decode(buildPdf(lines));
    const drawn = drawnText(pdf);
    expect(drawn).toHaveLength(200);
    expect(drawn[0]).toBe("row 0");
    expect(drawn[199]).toBe("row 199");
  });

  it("declares one Page object and one content stream per page", () => {
    const pdf = decode(
      buildPdf(Array.from({ length: 200 }, (_, i) => ({ text: `row ${i}` }))),
    );
    const pages = pageCount(pdf);
    expect(pdf.match(/\/Type \/Page[^s]/g)).toHaveLength(pages);
    // Anchored on the leading newline: a bare /stream\n/ also matches the
    // "endstream\n" that closes each one, and counts every page twice.
    expect(pdf.match(/\nstream\n/g)).toHaveLength(pages);
    // Kids must name exactly those Page objects, or a reader shows fewer pages
    // than the document contains.
    expect(pdf.match(/\/Kids \[(.*?)\]/)![1]!.match(/0 R/g)).toHaveLength(
      pages,
    );
  });

  it("still ends with a valid xref whose offsets are in ascending order", () => {
    const pdf = decode(
      buildPdf(Array.from({ length: 120 }, (_, i) => ({ text: `row ${i}` }))),
    );
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets.length).toBeGreaterThan(0);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    // Every offset must actually land on an object header.
    for (const offset of offsets) {
      expect(pdf.slice(offset)).toMatch(/^\d+ 0 obj\n/);
    }
  });
});

describe("buildSpreadsheetPdf", () => {
  const sheet = (rows: string[][], name = "Sheet1"): SheetTable => ({
    name,
    rows,
  });

  it("names the original file so the page and the chip agree", () => {
    const document = buildSpreadsheetPdf("q2-expenses.xlsx", [
      sheet([["Vendor"], ["Datadog"]]),
    ]);
    expect(drawnText(decode(document.bytes))).toContain("q2-expenses.xlsx");
  });

  it("renders a header rule under the first row", () => {
    const document = buildSpreadsheetPdf("book.xlsx", [
      sheet([
        ["Vendor", "Amount"],
        ["Datadog", "4210.50"],
      ]),
    ]);
    const drawn = drawnText(decode(document.bytes));
    expect(drawn.some((line) => /^-+\s+-+$/.test(line))).toBe(true);
  });

  it("aligns columns to a constant width so the header sits over its value", () => {
    const document = buildSpreadsheetPdf("book.xlsx", [
      sheet([
        ["Vendor", "Amount"],
        ["A", "1"],
        ["A much longer vendor", "2"],
      ]),
    ]);
    const drawn = drawnText(decode(document.bytes));
    const rows = drawn.filter(
      (line) => / {2}/.test(line) && !line.startsWith("-"),
    );
    expect(rows).toHaveLength(3);
    // The START OF THE FINAL TOKEN is the second column's origin. Measured that
    // way rather than with indexOf("  "), which finds the first gap inside the
    // padding of a short first column and so differs on every row by design.
    const offsets = rows.map((row) => row.search(/\S+$/));
    expect(new Set(offsets).size).toBe(1);
  });

  it("carries every data row into the document", () => {
    const rows = [
      ["Vendor", "Amount"],
      ...Array.from({ length: 150 }, (_, i) => [`Vendor ${i}`, String(i)]),
    ];
    const document = buildSpreadsheetPdf("big.xlsx", [sheet(rows)]);
    const pdf = decode(document.bytes);
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(document.totalRows).toBe(151);
    const drawn = drawnText(pdf).join("\n");
    expect(drawn).toContain("Vendor 0");
    expect(drawn).toContain("Vendor 149");
  });

  it("names each sheet when there is more than one, and stays quiet when there is not", () => {
    const many = buildSpreadsheetPdf("book.xlsx", [
      sheet([["a"]], "Q2 Expenses"),
      sheet([["b"]], "Policy Limits"),
    ]);
    const manyText = drawnText(decode(many.bytes));
    expect(manyText).toContain("Q2 Expenses");
    expect(manyText).toContain("Policy Limits");

    const one = buildSpreadsheetPdf("book.xlsx", [sheet([["a"]], "Sheet1")]);
    expect(drawnText(decode(one.bytes))).not.toContain("Sheet1");
  });

  it("reports truncation instead of clipping a wide cell invisibly", () => {
    const wide = "x".repeat(400);
    const document = buildSpreadsheetPdf("wide.xlsx", [
      sheet([["Notes"], [wide]]),
    ]);
    expect(document.truncatedCells).toBeGreaterThan(0);
    const drawn = drawnText(decode(document.bytes)).join("\n");
    expect(drawn).toContain("truncated");
    // And the surviving cell must actually fit the drawable width.
    for (const line of drawnText(decode(document.bytes))) {
      expect(line.length).toBeLessThan(200);
    }
  });

  it("reports no truncation for a sheet that fits", () => {
    const document = buildSpreadsheetPdf("ok.xlsx", [
      sheet([
        ["Vendor", "Amount"],
        ["Datadog", "4210.50"],
      ]),
    ]);
    expect(document.truncatedCells).toBe(0);
    expect(drawnText(decode(document.bytes)).join("\n")).not.toContain(
      "truncated",
    );
  });
});
