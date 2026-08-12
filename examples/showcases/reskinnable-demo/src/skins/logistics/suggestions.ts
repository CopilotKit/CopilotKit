import type { Suggestion } from "@/shell/skin-contract";
// The pill's message is the SAME VALUE `skin.tsx`'s onSuggestionSelect matches
// on, so the interception cannot drift out of sync with the pill. A drifted
// string sends the prompt with the attachment dropped — see attach-rate-sheet.ts.
import { RATE_SHEET_MESSAGE } from "./attach-rate-sheet";

export const logisticsSuggestions: Suggestion[] = [
  { title: "Triage the tower", message: "What needs my attention right now?" },
  // BEAT 3c — navigate via real levers. Phrased so the request implies SEVERAL
  // levers at once (a limit, a sort, a status), because one filter reads as a
  // link with extra steps while four applied together read as someone who knows
  // the tool.
  //
  // WHAT THIS ACTUALLY PRODUCES, measured rather than hoped:
  // `?status=delayed&sort=value_desc&top=10`, three chips on the confirm card,
  // three tinted controls, and "Top 2 of 2 matching exceptions" over a two-row
  // board. It deliberately does NOT name an exception class — the class control
  // stays idle and is the lever the presenter pulls by hand on stage, which is
  // what proves the controls are wired both ways.
  //
  // It does not name one for a second reason, too. `data/seed.json` carries six
  // shipments and four exceptions, ONE PER CLASS, so any exception filter leaves
  // a single row — a one-row board is the worst available answer for this beat,
  // because on stage it is indistinguishable from a broken filter. A fatter seed
  // is what would let all four levers land together here, and widening it moves
  // every KPI, brief and OGUI figure in the skin, so it is its own change.

  {
    title: "Costliest breaches",
    message:
      "Take me to the ten costliest exceptions that are still delayed, biggest value first.",
  },
  {
    title: "Weigh the options",
    message: "PO-88213 is running late — what are my options?",
  },
  // BEAT 3a — drive the app, secret withheld. Named as a RELEASE the planner is
  // already entitled to make, because the PIN is a second factor and not an
  // authority override: on the seeded network the only options under Rosa's
  // $5,000 authority on PO-88213 are the reroute ($572) and the split ($4,350),
  // and the card offers the cheapest of them. Asking for the expedite ($8,400)
  // here would be asking the PIN to do beat 6's job.
  {
    title: "Release the reroute",
    message: "Release the reroute on PO-88213 — I'll authorize it.",
  },
  // BEAT 3d — multimodal in, durable artifact out. Intercepted in skin.tsx,
  // which stages the generated carrier rate sheet into the composer first. The
  // sheet quotes a lane the network does NOT carry, so a brief that cites it
  // could not have been assembled from the ledger the agent can already see.
  { title: "Ingest this rate sheet", message: RATE_SHEET_MESSAGE },
  {
    title: "Inventory at risk",
    message: "Which SKUs run out before their inbound arrives?",
  },
  {
    title: "Decision brief",
    message: "Build me a decision brief for this week's exceptions.",
  },
];
