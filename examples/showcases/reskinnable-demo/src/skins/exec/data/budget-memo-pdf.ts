/**
 * BEAT 3d — the ingested document, generated rather than checked in.
 *
 * The memo cites the LIVE Distribution opex breach: the period it reports on,
 * the plan/actual figures and the two driver amounts are all read off the
 * seed at request time (see `src/app/api/exec/v1/budget-memo/route.ts`), and
 * the seed materializes its periods relative to `now`. A committed PDF would
 * name one month forever — "August 2026" said every day this demo is ever
 * given — and would disagree with whatever the dashboard shows the moment
 * someone opens it, since the dashboard reads the same live seed. `*.pdf` is
 * also git-lfs tracked repo-wide, which a generated-at-request-time document
 * sidesteps entirely.
 *
 * The bytes come from the shell's document primitive (`@/shell/documents`):
 * every byte-level concern — the ASCII fold, the font dictionary, the
 * `/Length` and xref arithmetic — lives there and is pinned once for every
 * skin in `src/shell/documents/pdf.test.ts`. This file is only the memo's
 * CONTENT: a flat `Line[]` handed to `buildPdf`.
 *
 * Server-safe: plain TS, no React, no "use client".
 */

import { buildPdf } from "@/shell/documents";
import type { Line } from "@/shell/documents";

/**
 * The memo's fixed internal reference. Printed on every issue of the memo —
 * unlike a revision number or an exception's `explained` state, a memo
 * reference names the DOCUMENT, not a fact the ledger is entitled to settle.
 */
const MEMO_REF = "FIN-MEMO-2419";

// Matches the "Distribution center automation" initiative's owner in
// `seed.ts` — that initiative's note ties itself to this same opex overrun
// ("Integrator delay pushed go-live past quarter close; opex overrun tracks
// to this."), so a memo author with a near-identical but different name
// would read, on stage, as an error rather than a coincidence.
const AUTHOR_NAME = "Priya Nair";
const AUTHOR_TITLE = "Distribution Finance Business Partner";

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const PERCENT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export interface BudgetMemoInput {
  /** The period the memo reports on, already formatted for print (e.g. "August 2026"). */
  periodLabel: string;
  /** The memo's own date, already formatted for print. */
  memoDate: string;
  planUsd: number;
  actualUsd: number;
  /** Signed fraction of plan, e.g. 0.09 for a 9% overrun. */
  variancePct: number;
  /** Dollar amount attributed to the shipment-timing driver — the LARGER of the two. */
  timingUsd: number;
  /** Dollar amount attributed to the one-off warehouse lease true-up. */
  oneOffUsd: number;
}

/**
 * The memo the agent reads.
 *
 * Its two named drivers — a carrier's shipment-timing shift and a warehouse
 * lease true-up — exist ONLY here: `GET /ledger` states that Distribution
 * opex breached its plan but not why, so a narrative filed from this document
 * is visibly different from one assembled out of the dashboard alone. The
 * timing driver is always printed as the larger of the two, so the reader can
 * infer the narrative code (VAR-TIMING) without the memo ever printing one —
 * see the route for why a narrative code, a `filedAt`, or an exception status
 * must never appear here.
 */
export function buildBudgetMemoPdf(input: BudgetMemoInput): Uint8Array {
  const overrunUsd = input.actualUsd - input.planUsd;

  const lines: Line[] = [
    { text: "CASCADE INDUSTRIES", size: 16, bold: true },
    { text: "Department budget memo — Distribution", size: 10, gap: 2 },
    { text: `Ref ${MEMO_REF}`, size: 10 },
    { text: `Date ${input.memoDate}`, size: 10 },

    { text: "To: Office of the CFO", size: 10, gap: 14 },
    { text: `From: ${AUTHOR_NAME}, ${AUTHOR_TITLE}`, size: 10 },

    { text: "Summary", size: 12, bold: true, gap: 18 },
    {
      text:
        `Distribution operating expense for ${input.periodLabel} closed at ` +
        `${CURRENCY.format(input.actualUsd)} against a plan of ` +
        `${CURRENCY.format(input.planUsd)}, an overrun of ` +
        `${CURRENCY.format(overrunUsd)} (${PERCENT.format(Math.abs(input.variancePct))} ` +
        "over plan).",
      size: 10.5,
      gap: 6,
    },

    { text: "Drivers", size: 12, bold: true, gap: 18 },
    {
      text:
        `Shipment timing — ${CURRENCY.format(input.timingUsd)}. A carrier ` +
        "moved a block of sailings earlier than scheduled, so freight and " +
        "handling charges that belonged to next month landed in this " +
        "period instead. This reverses next month as the shifted volume " +
        "drops back out of the period.",
      size: 10.5,
      gap: 6,
    },
    {
      text:
        `Warehouse lease true-up — ${CURRENCY.format(input.oneOffUsd)}. A ` +
        "backdated rent and CAM reconciliation on the Council Bluffs " +
        "Distribution Center posted this period. This is a one-off " +
        "adjustment and does not recur.",
      size: 10.5,
      gap: 8,
    },

    {
      text:
        "No change to the full-year forecast is requested; both items are " +
        "recognized in the period they were incurred.",
      size: 10.5,
      gap: 18,
    },

    { text: AUTHOR_NAME, gap: 22, bold: true },
    { text: `${AUTHOR_TITLE}, Cascade Industries`, size: 10 },
  ];

  return buildPdf(lines);
}
