/**
 * BEAT 3d — the uploaded document, generated rather than checked in.
 *
 * Banking ships a static `public/sample-invoice-q2.pdf`. Rowan generates its
 * offer letter instead, for one reason: the letter's START DATE has to agree
 * with the seeded hire, and the seed materializes dates relative to `now` so a
 * demo given next year still shows a queue with sensible aging. A committed PDF
 * would say "starts 12 August 2026" forever, and the very first thing the agent
 * does with the document is read the start date out of it — so the one detail
 * that would visibly disagree is the one detail the beat turns on.
 *
 * The bytes come from the shell's document primitive (`@/shell/documents`), so
 * this file is only the letter's CONTENT: a flat `Line[]` handed to `buildPdf`.
 * It used to carry its own copy of the byte layout, and the copy had drifted —
 * it had no ASCII fold at all while computing `/Length` and its xref offsets
 * from JS string length and emitting UTF-8. The seed carries `Inés Vidal`,
 * `Sasha Bergström` and `Montréal`, all three reachable through
 * `GET /api/people/v1/offer-letter?employeeId=…`, so the letter rendered
 * mojibake AND a structurally wrong document. Both are gone by construction now
 * that the fold arrives with the primitive; `offer-letter-pdf.test.ts` pins it.
 *
 * Server-safe: plain TS, no React, no "use client".
 */

import { buildPdf } from "@/shell/documents";

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export interface OfferLetterInput {
  name: string;
  title: string;
  level: string;
  team: string;
  managerName: string;
  location: string;
  /** ISO date (YYYY-MM-DD) — read straight off the seeded employee record. */
  startDate: string;
}

/**
 * The letter the agent reads. Its contents are deliberately RICHER than the
 * app's own record: the week-one schedule, the equity grant and the safety
 * certification exist only here, so a packet built from the document is
 * visibly different from one the agent could have assembled from the roster
 * alone. That difference is how the room knows the file was actually read.
 */
export function buildOfferLetterPdf(input: OfferLetterInput): Uint8Array {
  const start = LONG_DATE.format(new Date(input.startDate));
  return buildPdf([
    { text: "ROWAN ROBOTICS", size: 16, bold: true },
    { text: "Offer of employment", size: 10, gap: 2 },
    { text: `Prepared for ${input.name}`, size: 10 },

    { text: `Dear ${input.name.split(" ")[0]},`, gap: 20 },
    {
      text: `We are delighted to confirm your appointment as ${input.title}`,
      gap: 8,
    },
    {
      text: `(${input.level}) on the ${input.team} team, reporting to ${input.managerName},`,
    },
    { text: `based in ${input.location}.` },

    { text: "Start date", size: 12, bold: true, gap: 18 },
    { text: `Your first day will be ${start}.`, gap: 6 },

    { text: "Equity", size: 12, bold: true, gap: 16 },
    {
      text: "12,000 restricted stock units, vesting over four years with a",
      gap: 6,
    },
    {
      text: "one-year cliff, subject to board approval at the next grant date.",
    },

    { text: "Before you start", size: 12, bold: true, gap: 16 },
    {
      text: "Robot-cell safety certification must be completed before you can",
      gap: 6,
    },
    {
      text: "access the lab floor. Facilities will schedule this in week one.",
    },

    { text: "Your first week", size: 12, bold: true, gap: 16 },
    { text: "Day 1  Laptop, badge, building access, and the lab tour", gap: 6 },
    { text: "Day 2  Payroll, benefits and equity paperwork with People Ops" },
    { text: "Day 3  Toolchain setup and repo access with your buddy" },
    { text: "Day 4  Robot-cell safety certification" },
    { text: "Day 5  First paired ticket on the actuation stack" },

    {
      text: "Please countersign and return this letter before your start date.",
      gap: 22,
    },
    { text: "Maya Lindqvist", gap: 16, bold: true },
    { text: "Head of People Ops, Rowan Robotics", size: 10 },
  ]);
}
