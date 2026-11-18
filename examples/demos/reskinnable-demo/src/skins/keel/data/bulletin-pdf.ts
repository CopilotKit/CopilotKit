/**
 * BEAT 3d — the ingested document, generated rather than checked in.
 *
 * A regulatory bulletin is built per request from the LIVE register, so every
 * policy it cites is a policy Harbor Point actually holds and its effective date
 * is always a sensible number of days out. A committed PDF would cite refs a
 * reseed had renamed and state an effective date in the past — and the effective
 * date is one of the facts the agent is asked to lift out of the document and
 * carry into the filed brief.
 *
 * The bytes come from the shell's document primitive (`@/shell/documents`):
 * every byte-level concern — the ASCII fold, the font dictionary, the `/Length`
 * and xref arithmetic — lives there and is pinned once for every skin in
 * `src/shell/documents/pdf.test.ts`. This file is only the bulletin's CONTENT: a
 * flat `Line[]` handed to `buildPdf`.
 *
 * WHY COURIER FOR THE TABLE. The columns are aligned by CHARACTER COUNT
 * (`padEnd`), which is true alignment only in a monospaced font — in Helvetica
 * "POL-114" and "STD-045" are different widths, so every row would start its
 * next column somewhere new. Set `mono` on any line whose spacing carries
 * meaning; leave it off for prose, which the shell wraps.
 *
 * ⚠️ WHAT THIS DOCUMENT MUST NOT PRINT: a revision label. `currentRevision` is a
 * REGISTER fact that `POST /briefs` settles server-side, and an external
 * regulator has no way to know which revision Harbor Point currently has in
 * force. Printing one here would hand the model the very field the route exists
 * to own, and the settlement would then only ever be confirming what the
 * document already said — the beat's proof, quietly reduced to a copy.
 *
 * Server-safe: plain TS, no React, no "use client".
 */

import { buildPdf, PDF_METRICS } from "@/shell/documents";
import type { Line } from "@/shell/documents";
import type { BulletinCitation } from "./bulletin-citations";

export interface BulletinInput {
  /** The issuing body, as the document names itself. */
  source: string;
  /** The knowledge space this bulletin covers, in the document's own words. */
  scope: string;
  /** The date the requirements take effect, already formatted for print. */
  effective: string;
  /** The bulletin's summary paragraph, one sentence per line. */
  summary: string[];
  /** Every policy the bulletin touches, carried and uncarried alike. */
  citations: BulletinCitation[];
}

/**
 * Column widths of the affected-documents table, in CHARACTERS — the header and
 * every body row are built from this ONE object, so they cannot drift apart.
 * Commerce learned this the hard way: its header spacing was hand-typed while
 * its rows used their own `padEnd` literals, the two happened to agree, and
 * nothing held them there.
 */
const COLUMNS = { ref: 10, title: 46 } as const;

/** Point size of the table body. The width budget below is computed at it. */
const BODY_SIZE = 10.5;

/**
 * The alignment contract, exported so it can be ASSERTED rather than eyeballed
 * on a rendered page. `bulletin-pdf.test.ts` checks the row width against the
 * drawable width; nothing in the app reads these.
 *
 * COLUMNS ONLY. The prose below is not bounded here at all — the shell wraps
 * every non-`mono` line, and `mono` lines are exempt from that wrap precisely
 * because their spacing is meaningful, which is what leaves THEIR fit this
 * file's to assert.
 */
export const BULLETIN_METRICS = {
  columns: COLUMNS,
  bodySize: BODY_SIZE,
  monoAdvance: PDF_METRICS.monoAdvance,
  drawableWidth: PDF_METRICS.drawableWidth,
} as const;

/**
 * One fixed-width cell. Truncating to `width - 1` guarantees at least one space
 * of gutter, so an over-long value can never push the next column out of line —
 * the failure mode a `padEnd`-only cell has.
 */
const cell = (text: string, width: number) =>
  text.slice(0, width - 1).padEnd(width, " ");

const tableRow = (ref: string, title: string): Line => ({
  text: cell(ref, COLUMNS.ref) + cell(title, COLUMNS.title).trimEnd(),
  mono: true,
  size: BODY_SIZE,
});

/**
 * The bulletin the agent reads.
 *
 * Its contents are deliberately richer than anything the register holds: the
 * issuing body, the effective date, the per-document required actions, and — the
 * load-bearing one — a policy reference the library does not carry. A brief
 * filed from this document is therefore visibly different from one assembled out
 * of `GET /ledger` alone, which is how the room knows the file was read.
 */
export function buildBulletinPdf(input: BulletinInput): Uint8Array {
  const lines: Line[] = [
    { text: input.source.toUpperCase(), size: 16, bold: true },
    { text: "Regulatory bulletin", size: 10, gap: 2 },
    { text: `Scope: ${input.scope}`, size: 10 },
    { text: `Requirements effective ${input.effective}`, size: 10 },

    { text: "Summary", size: 12, bold: true, gap: 18 },
    ...input.summary.map((text, index) => ({
      text,
      size: BODY_SIZE,
      gap: index === 0 ? 6 : 0,
    })),

    { text: "Affected documents", size: 12, bold: true, gap: 18 },
    { ...tableRow("REF", "DOCUMENT"), bold: true, gap: 6 },
    ...input.citations.map((citation) =>
      tableRow(citation.ref, citation.title),
    ),

    { text: "Required actions", size: 12, bold: true, gap: 18 },
  ];

  input.citations.forEach((citation, index) => {
    lines.push({
      text: `${citation.ref} — ${citation.requiredAction}`,
      size: BODY_SIZE,
      gap: index === 0 ? 6 : 8,
    });
  });

  lines.push(
    { text: "Attestation", size: 12, bold: true, gap: 18 },
    {
      text:
        "Holders must record their assessment of each affected document " +
        "against the requirements above.",
      size: BODY_SIZE,
      gap: 6,
    },
    {
      text:
        "Where a listed document is not maintained, record that fact rather " +
        "than leaving the line blank.",
      size: BODY_SIZE,
    },

    { text: "Marguerite Anselm", gap: 22, bold: true },
    { text: `Director of Standards, ${input.source}`, size: 10 },
  );

  return buildPdf(lines);
}
