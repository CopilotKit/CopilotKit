import type { Suggestion } from "@/shell/skin-contract";
// ⚠️ THE BEAT-3d PILL'S MESSAGE IS THIS CONSTANT, NEVER A RETYPED SENTENCE.
// `skin.tsx`'s `onSuggestionSelect` matches on this exact VALUE to intercept the
// click and drive the real composer, because the framework's suggestion path drops
// attachments. A drifted string silently takes the default send path: the prompt
// goes without the hotel confirmation, the agent invents nothing (correctly), and
// beat 3d fails looking like a model problem. See ./attach-hotel-confirmation.ts.
import { HOTEL_CONFIRMATION_MESSAGE } from "./attach-hotel-confirmation";

/**
 * Aeronova's suggestion pills — ONE PER BEAT, IN DEMO ORDER, so the presenter
 * never types. Registered by the shell with `available: "always"`.
 *
 * The order is the deck's order and is not cosmetic. Two constraints fix it:
 *
 *  - **Beat 4 comes BEFORE beat 5.** `data/beat-map.md` § "Where the passenger
 *    framing genuinely fights the beats", point 4: beat 4's preference includes
 *    "lead with whatever is disrupted", and beat 5 RESOLVES the cancelled return
 *    by rebooking it. Run beat 5 first and the disruption beat 4 is supposed to
 *    lead with is gone. (`bkg-av1423`'s 55-minute delay does survive beat 5, which
 *    is the seed's belt-and-braces for a presenter who goes out of order.)
 *  - **Beat 6 is LAST.** The room has to watch the concierge succeed at everything
 *    else before it is shown failing, or "it doesn't know this one" reads as a bug
 *    rather than as the setup.
 *
 * Beat 2 has no pill — it is demonstrated by RELOADING the page with the thread
 * open, which is why every terminal render in `tools.tsx` is keyed off `result`
 * rather than `status`.
 *
 * Each comment records what the pill was VERIFIED to produce against the seeded
 * ledger, and says plainly where verification stops. Anything downstream of the
 * model's choice of tool is a live-runtime property and is labelled as such.
 */
export const airlineSuggestions: Suggestion[] = [
  // ── BEAT 1 — gen-UI in the transcript ────────────────────────────────────
  // A CHART, because beat 1 is the demo's opening move and a picture is the
  // whole claim. Routes to `showFlightCadence`, which paints the cadence strip
  // from `data/flight-cadence.ts`.
  //
  // MEASURED against the shipped seed and the app's own clock (`SEED_NOW`, i.e.
  // 2026-07-14 — this app does NOT run on the wall clock), asserted in
  // `data/flight-cadence.test.ts`:
  //   7 markers · 0 flown · 7 ahead · 2 disrupted · average gap 11 days
  //   07-14 AV1423 LIM delayed · 07-21 AV1466 SCL cancelled · 08-05 AV7702 BOG
  //   08-13 AV2214 MIA · 08-27 AV1188 GRU · 09-02 AV0918 MAD · 09-19 AV0431 BOG
  //
  // So "about every 11 days" is the sentence the prose should quote, and it is
  // the honest answer to the question: every seeded trip is AHEAD of the demo
  // clock, so the strip is forward-looking and the GAPS carry the answer rather
  // than any count of flights behind us. Seven markers over 67 days is also why
  // this is a strip and not monthly bars — bars collapse it to three columns and
  // hide the two disrupted trips the later beats need on screen.
  //
  // It is phrased as frequency, not "summarize", so it is distinguishable from
  // the beat-4 pill below: this one is the cadence CHART, that one is the
  // preference-shaped trip summary through `showTrips`.
  {
    title: "How often do I fly?",
    message: "How often do I fly these days?",
  },

  // ── BEAT 3b — "what's on my screen?" ─────────────────────────────────────
  // VERIFIED: `layout.tsx` registers the ROUTE readable (the open segment, from
  // `useSkinSegments`) and each page registers its own on-screen readable, so this
  // pill answers differently on Trip, Your account and Rebook. `readables.test.tsx`
  // pins that the route readable and the per-page ones both exist and that the
  // prompt's SCREEN AWARENESS clause tells the agent that context IS its view;
  // `pages/on-screen-readables.test.tsx` pins that each readable's rows are the
  // rows its panel actually painted.
  //
  // The beat is asking on ONE page, navigating, and asking AGAIN. Ask it on Your
  // account, then on Rebook after the beat-3c pill has set the levers — the second
  // answer has to name the truncation ("5 of 10"), which is the part a global
  // readable cannot fake.
  {
    title: "What am I looking at?",
    message: "What's on my screen right now?",
  },

  // ── BEAT 3c — navigate via the app's real levers ──────────────────────────
  // Phrased so the request implies FOUR levers plus a limit at once, because one
  // filter reads as a link with extra steps while four applied together read as
  // someone who knows the tool.
  //
  // VERIFIED against the seed, and `data/rebooking-options.test.ts` asserts the
  // floor rather than this comment: on `bkg-av1466`'s 30-row board,
  // `window=evening` + `stops=nonstop` + `sort=price_asc` + `top=5` leaves TEN
  // matching rows, truncated to five. That matters — a one-row board is
  // indistinguishable from a broken filter on a projector. Expect four chips on
  // the confirm card, the same four controls tinted on `pages/rebook.tsx`, and a
  // "Top 5 of 10" caption over five rows.
  //
  // It names the RETURN leg in words rather than a confirmation code on purpose:
  // AV7QK2 covers both of Camila's legs, so a code would be genuinely ambiguous
  // (the API answers 409 rather than picking) and the pill would demonstrate the
  // ambiguity guard instead of the levers.
  {
    title: "Evening nonstops home",
    message:
      "Show me evening nonstops for my flight home from Lima, cheapest first, top 5.",
  },

  // ── BEAT 3a — drive the app, secret withheld ──────────────────────────────
  // VERIFIED: `bkg-av7702` is Camila's Buenos Aires trip on a FLEX fare, so the
  // change is already permitted and the amount due is purely a fare DIFFERENCE
  // ($96 on `o-7702-b`, $184 on `o-7702-a`) with no change fee — the sympathetic
  // version of this, not a penalty. `components/authorizable.ts` filters the card
  // to options the passenger is already entitled to take AND where money is
  // genuinely due, cheapest first, so the card offers the $96 move.
  //
  // The card is a SECOND FACTOR, not an entitlement override: asking for it on a
  // gated ticket would be asking the card to do beat 6's job, and
  // `src/app/api/airline/v1/authorizations/route.test.ts` walks every option on a
  // non-changeable booking and asserts all of them are still refused.
  //
  // The digits the passenger types never enter the AG-UI stream — open the
  // inspector and show the room. Any four digits are accepted; it is format-only,
  // exactly as logistics' PIN is (`data/card-authorization.ts` says so at the top).
  {
    title: "Move me to the earlier flight",
    message:
      "Move me to the earlier Buenos Aires flight — I'll pay the difference.",
  },

  // ── BEAT 3d — multimodal in, durable artifact out ─────────────────────────
  // Intercepted in `skin.tsx`, which stages the generated hotel confirmation PDF
  // into the real composer first. THE MESSAGE MUST STAY THIS CONSTANT — see the
  // import comment at the top of this file.
  //
  // VERIFIED: the document carries a last check-in time and a cancellation
  // deadline that exist NOWHERE in Aeronova's ledger, and the ledger carries an
  // arrival time that exists nowhere in the hotel's. The brief's headline is the
  // collision of the two — "AV1423 now lands 23:00; Casa Miraflores stops taking
  // arrivals at 22:30" — which is unforgeable proof the file was read, because
  // neither side alone could say it. `POST /briefs` OVERWRITES the ledger's facts
  // and reports what it settled and what it could not match, so the agent is told
  // rather than silently overruled (`briefs/route.test.ts`).
  //
  // The brief lives on the TRIP RECORD, not on the thread: delete the whole
  // conversation and it is still there. `render_trip_brief` then opens it on the
  // canvas, reading it back off the app rather than re-rendering what the model
  // said.
  { title: "Read my hotel confirmation", message: HOTEL_CONFIRMATION_MESSAGE },

  // ── BEAT 4 — long-term memory recall ─────────────────────────────────────
  // Placed AFTER the 3x pills so the room has already watched the concierge read,
  // drive and ingest before it is asked to remember: "it remembers me" lands
  // harder once the assistant is established as something that acts.
  //
  // VERIFIED, on the SEEDED memory in `intelligence/seed-memories.ts` — which
  // `dev/reset` re-writes, so a cold reset arms this with no warm-up run:
  //   - the phrasing is about SUMMARIZING rather than about the wall, which is
  //     what makes the note band the visible difference from pill 1;
  //   - the seeded preference has four checkable clauses (aisle, forward of the
  //     wing, never Basic Economy, times in America/Santiago) plus "lead with
  //     whatever is disrupted", and every one of them has a field in the substrate
  //     (`data/beat-map.md` § "Beat 4" tables them against `data/handling.ts`,
  //     `RebookingOption.fareBrand`, `Traveler.homeTimezone` and `Flight.status`);
  //   - the violet band at the top of `showTrips` carries the agent's own sentence
  //     naming the preference it applied. THAT BAND IS THE BEAT. Without it the
  //     room sees a competent summary and has no way to know anything was
  //     recalled.
  //
  // ⚠️ RUNTIME-CONDITIONAL. Without Intelligence there is no `recall_memory`: the
  // component still renders, the band is empty, and the ordering is whatever the
  // model chose. That degrades to "a good answer", not to an error — and it is NOT
  // this beat. Verify against a configured stack.
  {
    title: "Summarize my trips",
    message: "Summarize my trips for me.",
  },

  // ── BEAT 5 — the stored procedure ────────────────────────────────────────
  // "Handle it" is deliberately vague and names no action, because the claim is
  // that the concierge already knows the procedure and the presenter does not have
  // to recite it.
  //
  // VERIFIED against the seed:
  //   - the target is `bkg-av1466`, Camila's RETURN leg on the CANCELLED AV1466
  //     (LIM→SCL, 21 Jul). Cancelled means `checkFareChange` short-circuits to
  //     `involuntary` BEFORE the fare is consulted, so this booking is free to
  //     change on any fare and can never touch beat 6's gate — `fare-rules.test.ts`
  //     pins both directions;
  //   - three writes, in order: `rebookOntoOption` → `reseatPassenger` (preference
  //     `aisle`) → `notifyTripParty` (party `arrival-pickup`, template
  //     `new-arrival-time`). The booking carries an `arrival-pickup` contact —
  //     Diego Rojas — and the notify route copies the recipient off the BOOKING,
  //     so the sentence read aloud names the person the app actually contacted;
  //   - each write appends a `TripLogEntry`, and the notice entry carries a FORCED
  //     🚨 marker, so the change is un-skimmable from the back of the room;
  //   - the DISTRACTORS are what make "it picked the right three" a claim rather
  //     than a tautology: `showFlight`, `showSeatMap`, `showBoardingPass`,
  //     `showDisruption`, `showLoyalty`, `showRedemptions`, `trackBaggage` and
  //     `issueBoardingPass` are all registered alongside. Count them from the
  //     source (`grep -n 'name: "' tools.tsx`) rather than from this comment.
  //
  // ⚠️ RUNTIME-CONDITIONAL, as beat 4: with no `recall_memory` the concierge finds
  // no procedure and asks what the passenger would like done. Not an error, not the
  // beat.
  {
    title: "My flight home was cancelled",
    message: "My flight home just got cancelled — handle it.",
  },

  // ── BEAT 6 — teach it a procedure it does not have ───────────────────────
  // LAST in demo order. See the header.
  //
  // VERIFIED against the seed, and `data/fare-rules.test.ts` +
  // `data/fare-waiver-codes.test.ts` re-derive every claim below from the same
  // pure functions the routes recompute with:
  //   - `bkg-av2214` is Tomás's AV3PL9, LIM→MIA on BASIC ECONOMY, so
  //     `POST /bookings/bkg-av2214/change` answers 422 FARE_NOT_CHANGEABLE. The
  //     refusal names the FARE CONDITION and nothing else — not the word
  //     "exception", not a category, not "ask an agent";
  //   - its record documents a 3h 10m schedule change with notice AV-88214 on
  //     file, deliberately BELOW the 4-hour involuntary threshold: a real grievance
  //     the automatic rule does not cover, which is exactly when a human files an
  //     exception. That prose is on the booking's `fareNotes`, which the passenger
  //     reads and the agent is given; the code-shaped `waiverGround` behind it is
  //     stripped by `store.snapshot()` and never reaches the wire;
  //   - THREE bookings are gated, not two. `AV8RT4` (Inés, Promo Saver SCL→MAD, a
  //     physician's certificate on file) is the REPLAY case — a different person, a
  //     different fare and a DIFFERENT releasing category, so replaying the taught
  //     category verbatim is refused and the learned thing has to be the procedure.
  //     `AV5KD1` (Camila, Basic Economy SCL→GRU) documents NOTHING and is released
  //     by no category at all, which is what makes the decoys real rather than
  //     theoretical;
  //   - the filing form is on Your account, under "Fare exceptions". It lists the
  //     four justifying categories and the three decoys TOGETHER, unmarked, in
  //     catalogue order — a form that flagged the working ones would turn the
  //     demonstration into a guided tour.
  //
  // The demonstration is TWO clicks in that form — file the exception, then retry
  // the reissue — and both are bracketed into ONE recording by the chat's
  // `DemonstrationCard`, so the card shows three steps and hands the agent the
  // category that was filed. Filing a DECOY is worth doing live: it files cleanly,
  // appears on the trip record, and the retry stays refused.
  //
  // ⚠️ RUNTIME-CONDITIONAL, in one half. Gate → decline → demonstrate → summarize
  // needs no Intelligence at all: every tool in the chain is an ordinary client
  // tool and the REST gate is real. What needs it is the DURABLE half — with no
  // `save_memory` the concierge keeps the procedure for this conversation only, and
  // the fresh-thread replay on AV8RT4 (the actual proof of learning) cannot happen.
  //
  // NOT VERIFIED HERE: everything downstream of the model's choice of tool.
  // Whether it declines rather than bluffing, whether it reaches for
  // `offerWorkflowRecording` rather than a distractor, and whether a fresh thread
  // recalls and replays on the OTHER booking are all live-runtime properties, and
  // no test in this repo asserts them.
  {
    title: "Get Tomás onto the earlier flight",
    message: "Get Tomás onto the earlier Miami flight on AV3PL9.",
  },
];
