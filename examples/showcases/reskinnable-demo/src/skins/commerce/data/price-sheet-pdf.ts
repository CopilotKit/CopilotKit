/**
 * BEAT 3d — the uploaded document, generated rather than checked in.
 *
 * Banking ships a static `public/sample-invoice-q2.pdf`. Bellwether generates
 * its vendor price sheet instead, for one reason: the sheet's SHIP WINDOW has to
 * agree with the seeded scenario, and the seed materializes dates relative to
 * `now` so a demo given a year from now still shows a queue with sensible aging.
 * A committed PDF would say "ships week of 12 August 2026" forever, and the
 * schedule is one of the things the agent is asked to lift out of the document.
 *
 * The bytes come from the shell's document primitive (`@/shell/documents`) — it
 * was extracted from this file, so nothing about the layout changed, and this
 * file is now only the sheet's CONTENT: a flat `Line[]` handed to `buildPdf`.
 * Everything about encoding, fonts, offsets and the ASCII fold lives there, and
 * `src/shell/documents/pdf.test.ts` pins it once for every skin.
 *
 * WHY COURIER FOR THE TABLES (the one property this file has to keep in mind).
 * The columns here are aligned by CHARACTER COUNT (`padEnd`), which is only true
 * alignment in a monospaced font — in Helvetica "BW-ALD-CRW" and "BW-HRR-TEE" are
 * different widths, so every row would start its next column somewhere new and
 * the table would render visibly ragged. Courier's every glyph is exactly
 * 600/1000 em, so both the alignment AND the overflow bound reduce to arithmetic
 * on character counts (see `PRICE_SHEET_METRICS`). Set `mono` on any line whose
 * spacing carries meaning; leave it off for prose.
 *
 * Server-safe: plain TS, no React, no "use client".
 */

import { buildPdf, PDF_METRICS } from "@/shell/documents";
import type { Line } from "@/shell/documents";

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const DAY_MS = 86_400_000;
const dateIn = (days: number) =>
  LONG_DATE.format(new Date(Date.now() + days * DAY_MS));

export interface PriceSheetLine {
  sku: string;
  name: string;
  /** What the app currently pays. Present only for SKUs already in the range. */
  currentCost?: number;
  /** What the vendor is quoting for the new run. */
  quotedCost: number;
  minimumUnits: number;
}

export interface PriceSheetInput {
  vendor: string;
  season: string;
  lines: PriceSheetLine[];
}

/** A style the app already buys, so its quoted cost can be compared. */
interface CarriedLine extends PriceSheetLine {
  currentCost: number;
}

const isCarried = (line: PriceSheetLine): line is CarriedLine =>
  line.currentCost !== undefined;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The "Cost movement" section, DERIVED from the rows.
 *
 * Every clause here has to be computable from `lines`, because the agent lifts
 * this section out of the document and narrates it as fact. The vendor is a
 * query parameter (`/api/commerce/v1/price-sheet?vendor=…`), so the row set is
 * not fixed: a different vendor can quote fewer styles, quote them all flat, or
 * quote them DOWN. Nothing here may name a material, assert a cause, or assume
 * a direction — an earlier version claimed the rises were "driven by merino
 * price" while the only merino SKU in the sheet was quoted flat, which is
 * exactly the kind of sentence the document must never contain.
 */
function costMovementLines(all: PriceSheetLine[]): Line[] {
  const carried = all.filter(isCarried);
  if (carried.length === 0) return [];

  const moved = carried.filter((l) => l.quotedCost !== l.currentCost);
  const up = moved.filter((l) => l.quotedCost > l.currentCost).length;
  const down = moved.length - up;
  const held = carried.length - moved.length;
  const fresh = all.length - carried.length;

  const out: Line[] = [
    { text: "Cost movement", size: 12, bold: true, gap: 16 },
  ];
  moved.forEach((line, index) => {
    const direction = line.quotedCost > line.currentCost ? "up" : "down";
    out.push({
      text:
        `${line.name}: ${direction} from $${line.currentCost} ` +
        `to $${line.quotedCost} per unit.`,
      gap: index === 0 ? 6 : 0,
    });
  });

  const counts: string[] = [];
  if (up) counts.push(`${up} up`);
  if (down) counts.push(`${down} down`);
  if (held) counts.push(`${held} holding at last cost`);
  let summary =
    `Of ${plural(carried.length, "carried-over style")}: ` +
    `${counts.join(", ")}.`;
  if (fresh) summary += ` ${plural(fresh, "style")} quoted for the first time.`;
  out.push({ text: summary, gap: 6 });

  return out;
}

/**
 * Column widths of the quoted-cost table, in CHARACTERS — the header and every
 * body row are built from this ONE object, so they cannot drift apart. Before it
 * existed the header's spacing was hand-typed while the rows used their own
 * `padEnd` literals; the two happened to agree, and nothing held them there.
 */
const COLUMNS = { sku: 15, style: 22, cost: 9 } as const;

/** Width of the ship schedule's week-label column, in characters. */
const WEEK_LABEL_WIDTH = 8;

/**
 * One fixed-width cell. Truncating to `width - 1` guarantees at least one space
 * of gutter, so an over-long value can never push the next column out of line —
 * the failure mode a `padEnd`-only cell has.
 */
const cell = (text: string, width: number) =>
  text.slice(0, width - 1).padEnd(width, " ");

/** A row of the quoted-cost table. Drawn mono, so the columns are real. */
const tableRow = (
  sku: string,
  style: string,
  cost: string,
  moq: string,
): Line => ({
  text:
    cell(sku, COLUMNS.sku) +
    cell(style, COLUMNS.style) +
    cell(cost, COLUMNS.cost) +
    moq,
  mono: true,
});

/** A row of the ship schedule. Also mono: its label column is padded too. */
const scheduleRow = (
  label: string,
  milestone: string,
  days: number,
  gap?: number,
): Line => ({
  text: `${cell(label, WEEK_LABEL_WIDTH)}${milestone} (${dateIn(days)})`,
  mono: true,
  gap,
});

/**
 * The alignment contract, exported so it can be ASSERTED rather than eyeballed on
 * a rendered page: the column widths every row is built from, plus the shell's
 * two page metrics re-exported alongside them so a caller reads ONE object.
 * `price-sheet-pdf.layout.test.ts` reads these and checks the emitted bytes
 * against them; nothing in the app reads them.
 */
export const PRICE_SHEET_METRICS = {
  columns: COLUMNS,
  weekLabelWidth: WEEK_LABEL_WIDTH,
  monoAdvance: PDF_METRICS.monoAdvance,
  drawableWidth: PDF_METRICS.drawableWidth,
} as const;

/**
 * The price sheet the agent reads. Its contents are deliberately RICHER than
 * the app's own catalog: the freight terms, the minimum order quantities, the
 * quoted cost movement and the ship schedule exist ONLY here. A restock plan
 * built from the document is therefore visibly different from one the agent
 * could have assembled from the catalog alone — which is how the room knows the
 * file was actually read rather than politely acknowledged.
 */
export function buildPriceSheetPdf(input: PriceSheetInput): Uint8Array {
  const lines: Line[] = [
    { text: input.vendor.toUpperCase(), size: 16, bold: true },
    { text: `${input.season} price sheet`, size: 10, gap: 2 },
    { text: "Prepared for Bellwether - Merchandising", size: 10 },
    { text: `Quote valid until ${dateIn(21)}`, size: 10 },

    { text: "Quoted landed costs", size: 12, bold: true, gap: 18 },
    { ...tableRow("SKU", "Style", "Cost", "MOQ"), bold: true, gap: 6 },
  ];

  for (const line of input.lines) {
    lines.push(
      tableRow(
        line.sku,
        line.name,
        `$${line.quotedCost}`,
        `${line.minimumUnits} units`,
      ),
    );
  }

  lines.push(...costMovementLines(input.lines));

  lines.push(
    { text: "Terms", size: 12, bold: true, gap: 16 },
    { text: "FOB mill. Freight surcharge of 4% applies to all", gap: 6 },
    { text: "shipments under 1,000 units. Net 45 from ship date." },
    { text: "30% deposit due with the purchase order." },

    { text: "Ship schedule", size: 12, bold: true, gap: 16 },
    scheduleRow("Week 1", "Purchase order countersigned", 7, 6),
    scheduleRow("Week 3", "Lab dips and strike-offs approved", 21),
    scheduleRow("Week 6", "Bulk leaves the mill", 42),
    scheduleRow("Week 9", "Landed at the Reno DC", 63),
    scheduleRow("Week 10", "On sale", 70),

    {
      text: "Countersign and return with the purchase order to hold this quote.",
      gap: 22,
    },
    { text: "Ilse Ruijter", gap: 16, bold: true },
    { text: `Head of Wholesale, ${input.vendor}`, size: 10 },
  );

  return buildPdf(lines);
}
