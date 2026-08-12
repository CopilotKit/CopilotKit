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
  // BEAT 4 — long-term memory recall. Placed AFTER the 3x pills so the room has
  // already watched the agent read, drive and ingest before it is asked to
  // remember: "it remembers me" lands harder once the assistant is established
  // as something that acts.
  //
  // WHAT THIS ACTUALLY PRODUCES, measured against the seeded network rather
  // than hoped:
  //   - the phrasing is deliberately about the SHAPE of the queue, not the rows,
  //     which is what routes it to `showExceptionSummary` rather than
  //     `showExceptions`. "What needs my attention" (pill 1) routes to the board
  //     — the two pills are asking different questions on purpose;
  //   - with the seeded preference recalled the answer is FOUR lane groups
  //     (SHA→LAX ocean, RTM→NYC ocean, MTY→DFW truck each carry the four
  //     exceptions between them), exposure printed as "$240k" not "$240,000",
  //     and MTY→DFW lifted above lanes worth eight times more because it is
  //     already past its promised date;
  //   - and the violet band at the top of the component carries the agent's own
  //     sentence naming the preference. THAT BAND IS THE BEAT. Without it the
  //     room sees a competent summary and has no way to know anything was
  //     recalled.
  //
  // ⚠️ RUNTIME-CONDITIONAL. Without Intelligence there is no `recall_memory`:
  // the component still renders, the band is usually empty, and the grouping is
  // whatever the model chose. That degrades to "a good answer", not to an error
  // — and it is NOT this beat. Verify against a configured stack.
  {
    title: "How do the exceptions stand?",
    message: "Give me a summary of where the exceptions stand right now.",
  },
  // BEAT 5 — the stored procedure. "Handle it" is deliberately vague and names
  // no action, because the claim is that the agent already knows the procedure
  // and the presenter does not have to recite it.
  //
  // WHAT THIS ACTUALLY PRODUCES, measured:
  //   - PO-88251 is the target on purpose. It is NOT beat 3a's shipment
  //     (PO-88213, where the PIN card releases the reroute) and NOT beat 6's
  //     (PO-88213's $8,400 expedite, the one over Rosa's $5,000 authority). One
  //     shipment carrying three beats is how a presenter ends up demonstrating
  //     the wrong one;
  //   - three tool-activity chips in a row — "Flagging it on the board",
  //     "Messaging the carrier", "Noting it on the shipment" — and then a single
  //     confirming sentence;
  //   - on the Control Tower board, the PO-88251 row grows a red WATCH chip, a
  //     "Carrier notified" chip and a 🚨 count. The distractors registered
  //     alongside the three real writes — proof of delivery, drayage, a lane
  //     capacity forecast, a cargo claim — are what make "it picked the right
  //     three" a claim rather than a tautology. Count them from the source
  //     (`grep -n 'name: "' tools.tsx`) rather than from this comment.
  //
  // ⚠️ RUNTIME-CONDITIONAL, as beat 4: with no `recall_memory` the agent finds
  // no procedure and asks what the planner would like done. Not an error, not
  // the beat.
  {
    title: "Norte's gone quiet",
    message: "Norte Freight has gone dark on PO-88251 — handle it.",
  },
  {
    title: "Inventory at risk",
    message: "Which SKUs run out before their inbound arrives?",
  },
  {
    title: "Decision brief",
    message: "Build me a decision brief for this week's exceptions.",
  },
];
