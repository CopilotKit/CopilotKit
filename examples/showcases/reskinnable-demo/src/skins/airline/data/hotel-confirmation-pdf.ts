/**
 * BEAT 3d — the uploaded document, generated rather than checked in.
 *
 * A committed PDF would name a hotel a reseed had moved and a check-in date in
 * the past — and the check-in date is one of the things the agent is asked to
 * lift out of the document. Generated per request from the live ledger, it is
 * always about a trip the app still holds.
 *
 * The bytes come from the shell's document primitive (`@/shell/documents`):
 * every byte-level concern — the ASCII fold, the Helvetica + Courier font
 * dictionary, the `/Length` and xref arithmetic, and the prose wrap — lives
 * there and is pinned once for all six skins in `src/shell/documents/pdf.test.ts`.
 * This file is only the reservation's CONTENT: a flat `Line[]` handed to
 * `buildPdf`.
 *
 * The fold matters here more than usual: this skin's travelers are `Camila
 * Rojas`, `Tomás Aguirre` and `Inés Vidal`, and the seeded address is `Calle
 * Berlín 424`. All four reach this document. `hotel-confirmation-pdf.test.ts`
 * asserts every emitted byte is `< 0x80`.
 *
 * WHY COURIER FOR THE TABLE. The stay summary is aligned by CHARACTER COUNT
 * (`padEnd`), which is only true alignment in a monospaced font — in Helvetica
 * every row would start its next column somewhere new. Set `mono` on any line
 * whose spacing carries meaning; leave it off for prose, which the shell wraps.
 *
 * ⚠️ THE DOCUMENT MUST NOT MENTION THE FLIGHT. A hotel knows its own room, its
 * own deadlines and its own prices; it does not know when the guest's plane
 * lands. The whole proof of beat 3d is that the brief's headline — "lands 23:00,
 * desk closes 22:30" — cannot be derived from either source alone. Print an
 * arrival time here and the beat quietly stops proving anything. See
 * `hotel-confirmations.ts`.
 *
 * ⚠️ AND EVERY SENTENCE IS DERIVED FROM THE ROWS ABOVE IT. The agent lifts these
 * sentences out and narrates them, so a claim the document's own numbers
 * contradict becomes something the assistant asserts to the room. Nothing below
 * names a total, a deadline or a charge that was not computed from the entry in
 * front of it.
 *
 * Server-safe: plain TS, no React, no "use client".
 */

import { buildPdf, PDF_METRICS } from "@/shell/documents";
import type { Line } from "@/shell/documents";
import type { HotelConfirmationEntry } from "./hotel-confirmations";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The stay's total, derived. Never a field, so it can never disagree. */
export const stayTotalUsd = (entry: HotelConfirmationEntry): number =>
  entry.nightlyRateUsd * entry.nights;

/**
 * The arrival paragraph, derived from the entry's own deadline.
 *
 * Two sentences, and the second is the one the whole beat turns on: a room that
 * is released at a stated time is a fact only this document holds. It is stated
 * plainly, without hedging, because the agent has to be able to quote it.
 */
export function arrivalLines(entry: HotelConfirmationEntry): string[] {
  return [
    `The front desk accepts arrivals until ${entry.lastCheckInLocal} on the ` +
      `night of check-in.`,
    `Rooms are released after ${entry.lastCheckInLocal} unless the desk has ` +
      `been asked to hold them.`,
  ];
}

/**
 * The cancellation paragraph, derived from the deadline AND the prepaid flag.
 *
 * A prepaid stay and a pay-on-arrival stay lose different amounts of money after
 * the same deadline, so the sentence says which — computed, never asserted. A
 * fixed "the first night is charged" would have been wrong on one of the two
 * seeded rows.
 */
export function cancellationLines(entry: HotelConfirmationEntry): string[] {
  const penalty = entry.prepaid
    ? `the full prepaid amount of ${usd(stayTotalUsd(entry))} is non-refundable`
    : `the first night at ${usd(entry.nightlyRateUsd)} is charged to the card on file`;
  return [
    `Free cancellation until ${entry.cancellationDeadlineLocal} on ` +
      `${entry.checkInDate}. After that, ${penalty}.`,
  ];
}

/**
 * Column widths of the stay summary, in CHARACTERS — the header and every body
 * row are built from this ONE object, so they cannot drift apart.
 */
const COLUMNS = { label: 22, value: 26 } as const;

/** Point size of the table body. The width budget below is computed at it. */
const BODY_SIZE = 10.5;

/**
 * The alignment contract, exported so it can be ASSERTED rather than eyeballed
 * on a rendered page. `hotel-confirmation-pdf.test.ts` checks the row width
 * against the shell's drawable width; nothing in the app reads these.
 *
 * COLUMNS ONLY. The prose is not bounded here at all — `buildPdf` wraps it, and
 * `mono` lines are exempt from that wrap precisely because their spacing is
 * meaningful, which is what leaves THEIR fit this file's to assert.
 */
export const HOTEL_CONFIRMATION_METRICS = {
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

const row = (label: string, value: string): Line => ({
  text: cell(label, COLUMNS.label) + value,
  mono: true,
  size: BODY_SIZE,
});

const section = (heading: string, sentences: string[]): Line[] =>
  sentences.length === 0
    ? []
    : [
        { text: heading, size: 12, bold: true, gap: 16 },
        ...sentences.map((text, index) => ({
          text,
          size: BODY_SIZE,
          gap: index === 0 ? 6 : 0,
        })),
      ];

/**
 * The confirmation the passenger attaches.
 *
 * Its contents are deliberately RICHER than anything Aeronova holds: the room,
 * the price, the confirmation number, the cancellation deadline and — the
 * load-bearing one — the hour the front desk stops taking arrivals exist ONLY
 * here. A trip brief built from this document is therefore visibly different
 * from one the agent could have assembled from the ledger alone, which is how
 * the room knows the file was actually read rather than politely acknowledged.
 */
export function buildHotelConfirmationPdf(
  entry: HotelConfirmationEntry,
): Uint8Array {
  const lines: Line[] = [
    { text: entry.hotelName.toUpperCase(), size: 16, bold: true },
    { text: "Reservation confirmation", size: 10, gap: 2 },
    { text: entry.address, size: 10 },
    { text: entry.city, size: 10 },

    { text: "Your stay", size: 12, bold: true, gap: 18 },
    { ...row("DETAIL", "VALUE"), bold: true, gap: 6 },
    row("Guest", entry.guestName),
    row("Confirmation", entry.confirmationNumber),
    row("Check-in", entry.checkInDate),
    row("Nights", String(entry.nights)),
    row("Rate per night", usd(entry.nightlyRateUsd)),
    row("Total", usd(stayTotalUsd(entry))),
    row("Payment", entry.prepaid ? "Prepaid in full" : "Due on arrival"),

    ...section("Arrival", arrivalLines(entry)),
    ...section("Cancellation", cancellationLines(entry)),

    {
      text:
        `Quote confirmation ${entry.confirmationNumber} when you contact the ` +
        `desk about this reservation.`,
      gap: 22,
    },
    { text: "Guest Services", gap: 16, bold: true },
    { text: entry.hotelName, size: 10 },
  ];

  return buildPdf(lines);
}
