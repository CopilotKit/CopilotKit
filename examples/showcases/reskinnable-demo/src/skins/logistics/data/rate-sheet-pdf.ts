/**
 * BEAT 3d — the uploaded document, generated rather than checked in.
 *
 * A carrier rate sheet is generated per request from the live network, so the
 * lanes it quotes are the lanes Meridian actually moves freight on and its
 * effective date is always a sensible number of days out. A committed PDF would
 * quote lanes a reseed had renamed and an effective date in the past — and the
 * effective date is one of the things the agent is asked to lift out of the
 * document.
 *
 * The bytes come from the shell's document primitive (`@/shell/documents`):
 * every byte-level concern — the ASCII fold, the Helvetica + Courier font
 * dictionary, the `/Length` and xref arithmetic — lives there and is pinned once
 * for all six skins in `src/shell/documents/pdf.test.ts`. This file is only the
 * sheet's CONTENT: a flat `Line[]` handed to `buildPdf`.
 *
 * WHY COURIER FOR THE TABLE (the one property this file has to keep in mind).
 * The columns here are aligned by CHARACTER COUNT (`padEnd`), which is only true
 * alignment in a monospaced font — in Helvetica "SHA-LAX" and "MTY-DFW" are
 * different widths, so every row would start its next column somewhere new. Set
 * `mono` on any line whose spacing carries meaning; leave it off for prose.
 *
 * AND THE PROPERTY THE PRIMITIVE CANNOT ENFORCE: every sentence below is derived
 * from the rows it was handed. The agent lifts these sentences out and narrates
 * them to the room, so a claim the document's own numbers contradict becomes
 * something the assistant asserts on stage. Nothing here names a cause, a mode
 * or a direction that was not computed from the two rates in front of it.
 *
 * NOT TO BE CONFUSED WITH `build-brief-ops.ts`, which builds the a2ui operations
 * for the canvas brief (`SURFACE_ID = "decision-brief"`). That one is a RENDER
 * and dies with the thread; this one feeds a stored `RateBrief` record that
 * outlives it.
 *
 * Server-safe: plain TS, no React, no "use client".
 */

import { buildPdf, PDF_METRICS } from "@/shell/documents";
import type { Line } from "@/shell/documents";

export interface RateSheetLane {
  /** Lane code as printed, e.g. "SHA-LAX". */
  lane: string;
  mode: string;
  /**
   * What Meridian pays today. ABSENT — never `0`, and never equal to the new
   * rate — on a lane the network has never carried: the document must not claim
   * a rate history it does not have, and `costMovementLines` reads the absence
   * as "no prior rate on file" rather than as a movement of unknown size.
   */
  oldRateUsdPerKg?: number;
  /** What the carrier is quoting from the effective date. */
  newRateUsdPerKg: number;
  /** Quoted transit in days. Only stated for lanes the sheet introduces. */
  transitDays?: number;
}

export interface RateSheetInput {
  carrier: string;
  /** The date the quoted rates take effect, already formatted for print. */
  asOf: string;
  lanes: RateSheetLane[];
}

/** A lane the network already carries, so its movement can be computed. */
interface CarriedLane extends RateSheetLane {
  oldRateUsdPerKg: number;
}

const isCarried = (lane: RateSheetLane): lane is CarriedLane =>
  typeof lane.oldRateUsdPerKg === "number" &&
  Number.isFinite(lane.oldRateUsdPerKg) &&
  lane.oldRateUsdPerKg > 0;

const usd = (rate: number) => `$${rate.toFixed(2)}`;

/**
 * One sentence per lane that ACTUALLY MOVED, with the direction computed from
 * the two rates.
 *
 * Never names a cause, a mode or a direction that was not derived from these
 * rows: the agent lifts these sentences out and narrates them to the room, so a
 * claim the document's own numbers contradict becomes something the assistant
 * asserts on stage. A flat lane produces no sentence, a lane with no prior rate
 * produces no sentence (it did not move; it is new — see `newServiceLines`), and
 * an all-flat sheet produces none at all rather than a reassuring summary.
 *
 * Both rates are stated alongside the percentage because the percentage is the
 * claim most easily wrong and least easily checked from the back of a room.
 */
export function costMovementLines(lanes: RateSheetLane[]): string[] {
  return lanes
    .filter(isCarried)
    .filter((lane) => lane.newRateUsdPerKg !== lane.oldRateUsdPerKg)
    .map((lane) => {
      const delta = lane.newRateUsdPerKg - lane.oldRateUsdPerKg;
      const pct = Math.abs((delta / lane.oldRateUsdPerKg) * 100);
      const direction = delta > 0 ? "up" : "down";
      return (
        `${lane.lane} (${lane.mode}) is ${direction} ${pct.toFixed(1)}% — ` +
        `${usd(lane.oldRateUsdPerKg)} to ${usd(lane.newRateUsdPerKg)} per kg.`
      );
    });
}

/**
 * One sentence per lane the sheet INTRODUCES — quoted, but never carried.
 *
 * This is the row the app's own data cannot supply, and therefore the sentence
 * that makes "did it actually read the document?" answerable at a glance. It
 * states only what the row holds: the rate, and the transit when the row carries
 * one. It never guesses at a prior rate, and it says the absence out loud so the
 * agent has the words for it instead of inventing a comparison.
 */
export function newServiceLines(lanes: RateSheetLane[]): string[] {
  return lanes
    .filter((lane) => !isCarried(lane))
    .map((lane) => {
      // "days transit", not "port to port": the sheet quotes truck and rail
      // lanes too, and a port-to-port claim on MTY-HOU is a detail the row does
      // not support — which the agent would then read out as fact.
      const transit = lane.transitDays
        ? `, ${lane.transitDays} days transit`
        : "";
      return (
        `${lane.lane} (${lane.mode}) is new service at ` +
        `${usd(lane.newRateUsdPerKg)} per kg${transit} — no prior rate on file ` +
        `with Meridian.`
      );
    });
}

/**
 * Column widths of the quoted-rate table, in CHARACTERS — the header and every
 * body row are built from this ONE object, so they cannot drift apart. Commerce
 * learned this the hard way: its header spacing was hand-typed while its rows
 * used their own `padEnd` literals, the two happened to agree, and nothing held
 * them there.
 */
const COLUMNS = { lane: 12, mode: 9, was: 11, now: 11 } as const;

/** Point size of the table body. The width budget below is computed at it. */
const BODY_SIZE = 10.5;

/**
 * The alignment contract, exported so it can be ASSERTED rather than eyeballed
 * on a rendered page: the column widths every row is built from, the size they
 * are drawn at, and the shell's page metrics re-exported alongside them so a
 * caller reads ONE object. `rate-sheet-pdf.test.ts` checks the row width against
 * the drawable width; nothing in the app reads these.
 */
export const RATE_SHEET_METRICS = {
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

/** A row of the quoted-rate table. Drawn mono, so the columns are real. */
const tableRow = (
  lane: string,
  mode: string,
  was: string,
  now: string,
): Line => ({
  text:
    cell(lane, COLUMNS.lane) +
    cell(mode, COLUMNS.mode) +
    cell(was, COLUMNS.was) +
    now,
  mono: true,
  size: BODY_SIZE,
});

/**
 * The character budget for one line of prose, and why it is not exact.
 *
 * The shell's writer draws a `Line` at a fixed x and never wraps — a line that
 * does not fit simply runs off the right margin, where a reader CLIPS it. The
 * table rows are safe by construction (Courier, bounded by `COLUMNS` above), but
 * the derived sentences below are not: their length depends on the lane codes and
 * rates the route hands in, and the first version of this file shipped a
 * 111-character "New service" line that ran a third of the way off the page.
 *
 * Prose is drawn in Helvetica, whose advances vary per glyph, so an exact bound
 * would need the base-14 width table. Courier's 600/1000 is used as a stand-in
 * instead: Helvetica's lowercase and digits are 556/1000 and its space is
 * 278/1000, so 600 is comfortably conservative for the mixed-case sentences
 * here. It is NOT an absolute bound for ALL-CAPS text (Helvetica "W" is
 * 944/1000), which is why the headings and the shouted words in these sentences
 * are kept short.
 */
const proseCharBudget = (size: number) =>
  Math.floor(PDF_METRICS.drawableWidth / (size * PDF_METRICS.monoAdvance));

/**
 * Break one sentence onto as many lines as it needs, on word boundaries.
 *
 * A word longer than the whole budget is left on its own line rather than being
 * split: hyphenating a lane code would invent a code that does not exist, and
 * the agent reads these lines aloud.
 */
export function wrapProse(text: string, size: number): string[] {
  const budget = proseCharBudget(size);
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line === "") {
      line = word;
    } else if (`${line} ${word}`.length <= budget) {
      line += ` ${word}`;
    } else {
      out.push(line);
      line = word;
    }
  }
  if (line !== "") out.push(line);
  return out;
}

/** A prose section, emitted ONLY when it has something derived to say. */
const section = (heading: string, sentences: string[]): Line[] => {
  if (sentences.length === 0) return [];
  const body = sentences.flatMap((sentence, index) =>
    wrapProse(sentence, BODY_SIZE).map((text, wrapped) => ({
      text,
      size: BODY_SIZE,
      // The gap opens the section, so it belongs to the first DRAWN line, not
      // to the first sentence — a wrapped continuation must not re-open it.
      gap: index === 0 && wrapped === 0 ? 6 : 0,
    })),
  );
  return [{ text: heading, size: 12, bold: true, gap: 16 }, ...body];
};

/**
 * The rate sheet the agent reads. Its contents are deliberately RICHER than the
 * app's own lane table: the quoted forward rates, the effective date, the terms
 * and — the load-bearing one — the lane the network has never carried exist ONLY
 * here. A brief built from the document is therefore visibly different from one
 * the agent could have assembled from `store.lanes()` alone, which is how the
 * room knows the file was actually read rather than politely acknowledged.
 */
export function buildRateSheetPdf(input: RateSheetInput): Uint8Array {
  const lines: Line[] = [
    { text: input.carrier.toUpperCase(), size: 16, bold: true },
    { text: "Carrier rate sheet", size: 10, gap: 2 },
    { text: "Prepared for Meridian - Network Planning", size: 10 },
    { text: `Rates effective ${input.asOf}`, size: 10 },

    { text: "Quoted lane rates", size: 12, bold: true, gap: 18 },
    { ...tableRow("LANE", "MODE", "WAS $/KG", "NOW $/KG"), bold: true, gap: 6 },
  ];

  for (const lane of input.lanes) {
    lines.push(
      tableRow(
        lane.lane,
        lane.mode,
        // "new", not "$0.00" and not a blank: the cell has to say WHY there is
        // no figure, because a blank reads as a missing value and a zero reads
        // as a rate the carrier once charged.
        isCarried(lane) ? usd(lane.oldRateUsdPerKg) : "new",
        usd(lane.newRateUsdPerKg),
      ),
    );
  }

  lines.push(
    ...section("Rate movement", costMovementLines(input.lanes)),
    ...section("New service", newServiceLines(input.lanes)),

    { text: "Terms", size: 12, bold: true, gap: 16 },
    {
      text: "Rates are per kilogram, all-in, and hold for 90 days from",
      gap: 6,
    },
    { text: "the effective date. Space is allocated first-committed." },
    { text: "Detention and demurrage are billed at cost." },

    {
      text: "Countersign and return to hold this quote for your allocation.",
      gap: 22,
    },
    { text: "Halvard Reyes", gap: 16, bold: true },
    { text: `Head of Trade, ${input.carrier}`, size: 10 },
  );

  return buildPdf(lines);
}
