# Aeronova — the beat map

> **Read this before adding a tool, a page, a prompt clause or a pill to the
> `airline` skin.** Per `.claude/skills/reskin/demo-beats.md`, the beat map
> decides all four; discovering the beats afterwards means rebuilding them.
>
> This file is the DESIGN, and **the design is now BUILT.** The REST substrate
> under `src/skins/airline/data/` and `src/app/api/airline/v1/` implements it, and
> the tools, prompt, pages, pills, readables, memories and teach loop that were
> "later slots" when this was written have all landed — Aeronova hits every beat.
> Read it as the design record, and check any claim about the current tree against
> the tree (`CLAUDE.md` § "Demo-beat coverage" carries the derivation commands).

---

## What Aeronova is

Aeronova is, and stays, a **passenger-facing travel concierge**. There is no
operations desk, no duty controller, no board of other people's problems. The
user is a passenger looking at their own trips.

An earlier attempt at this substrate concluded that a passenger concierge
cannot host beats 3a, 3c and 6 because a passenger has "no operator, no
authority, no board", and reframed the skin into an irregular-operations
control desk. **That reframe was rejected.** The correcting insight is the
premise of everything below:

> **Authority does not have to be ORGANIZATIONAL. It can be ENTITLEMENT.**
> A gate that says _"your fare does not permit this"_ refuses exactly as hard
> as one that says _"you lack approval authority"_, and it needs no hierarchy
> at all. The fare rules ARE the authority model.

Everything the beats wanted from an operator turns out to have a passenger
analogue that is more familiar, not less:

| An ops desk would have…    | A passenger has…                                                          |
| -------------------------- | ------------------------------------------------------------------------- |
| an approval authority      | **fare rules** — what this ticket permits                                 |
| an escalation to a manager | a **fare exception** filed under a waiver category, with documentation    |
| a board of cases           | **their own bookings** — an account with travel companions on it          |
| a filtered work queue      | the **rebooking search** everyone in the room has personally used         |
| a sign-off PIN             | the **card confirmation** on a paid change                                |
| a colleague to notify      | whoever is **meeting them at the airport**, or the hotel holding the room |

### The account

The substrate is one traveler profile — **Camila Rojas**, the account holder —
with two travel companions on the same profile (**Tomás Aguirre**, her
partner; **Inés Vidal**, her mother). That is an ordinary airline app: your
saved travelers, and every booking made for them. It is what gives beat 3c a
board and beat 6 more than one gated case without inventing a single
organizational role.

### It is ADDITIVE

`use-data.ts` (`useAirlineData`) — the concierge's in-memory React store — is
untouched and still drives the trip, loyalty and disruption pages. Nothing
here deletes or rewires it. A later slot migrates those consumers; until it
does, both substrates are live, and this seed is deliberately written NOT to
contradict the in-memory one (see "Where the two substrates touch", last
section).

---

## The map

| Beat              | Aeronova's step                                                                                     | Pill (suggested)                                     | Implemented by                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1 face            | The trip wall as gen-UI: every booking, its fare condition, and what is disrupted right now         | "How do my trips look?"                              | `GET /ledger` → a `useComponent` chart (later slot)                                              |
| 2 rich thread     | Every visual is `useComponent`, keyed off `result`; reload and the trip wall is still in the thread | (none — demonstrated by reloading)                   | later slot; substrate is replay-safe — every figure re-fetchable from `/ledger`                  |
| 3a drive the app  | Pay a fare difference by typing the **last 4 of the card on file** into a card in the chat          | "Move me to the earlier Buenos Aires flight"         | `data/card-authorization.ts` + `POST /authorizations`                                            |
| 3b sees my screen | Ask on Trips, navigate to the rebooking search, ask again                                           | "What am I looking at?"                              | route + per-page readables (later slot); `/ledger` is one snapshot                               |
| 3c levers         | The rebooking search: **departure window**, **stops**, **cabin**, **sort** — plus top-N, all tinted | "Evening nonstops home, cheapest first, top 5"       | `data/rebooking-levers.ts` + `data/rebooking-options.ts`                                         |
| 3d multimodal     | Attach a **hotel confirmation** → file a durable **Trip Brief** on the trip record                  | "Read my hotel confirmation and file the trip brief" | `GET /hotel-confirmation` + `POST /briefs` + `data/hotel-confirmation-pdf.ts`                    |
| 4 memory          | Seeded seat + fare preferences (aisle, forward cabin, never Basic Economy, times in her timezone)   | "Summarize my trips"                                 | `intelligence/seed-memories.ts` (later slot); substrate carries every field it needs             |
| 5 stored skill    | "My flight home just got cancelled — handle it" → rebook, reseat, notify, in order                  | "My flight home just got cancelled — handle it"      | `POST /bookings/[id]/change`, `/seat`, `/notify` + `data/handling.ts`                            |
| 6 teach a skill   | Change a **non-changeable** fare. Refused. Unlocked by a **fare exception** under a waiver category | "Get Tomás onto the Thursday Miami flight"           | `data/fare-waiver-codes.ts` + `data/fare-rules.ts` + `POST /fare-exceptions` (+ `/[id]/approve`) |
| (reset)           | Presenter reset restores the account and (later slot) re-seeds beats 4/5                            | (sidebar button, not a pill)                         | `POST /dev/reset`                                                                                |

Nine beats, eight pills (beat 2 is demonstrated by reloading). No ninth canvas
pill is proposed: the beat-3d pill both ingests the hotel confirmation AND
files the artifact — the `banking` shape, not the `people`/`commerce` one.

---

## Beat 3a — the secret the UI holds

**The last four digits of the payment card on file.** The passenger is making
a **paid** change: a fare difference, plus any change fee the fare charges. The
airline asks them to confirm the card. They type it into a card **in the chat**;
the agent never sees it, is told never to ask for it, and `POST /authorizations`
never echoes it — a refusal says "not accepted", never what was typed.

`readCardLast4()` in `data/card-authorization.ts` returns BOTH the guidance the
card prints and the predicate its submit button compares against, so the card
cannot invite a shape the server refuses. It REFUSES what it cannot read rather
than stripping characters — `Number(typed.replace(/[^0-9]/g,""))` turns `-4417`
into a valid confirmation — and reports "nothing typed yet" separately so an
untouched field is not scolded.

**Format-only, exactly as logistics' PIN is.** No card digits live in the seed
and the ledger never carries them (the profile exposes `paymentCardLabel`,
which is a brand and dots, never a number). Any four digits are accepted. That
is deliberate for a stage demo — the beat's claim is about WHERE the value
travels, not about authenticating anyone. `card-authorization.ts` says so at the
top; that comment is the thing to delete if this ever needs a real second
factor.

### ⚠️ It is NOT an entitlement override — this is the whole trap

`POST /authorizations` re-runs the **same** `checkFareChange()` the ordinary
change route runs, on figures it recomputes itself. **A valid card confirmation
on a non-changeable fare is still `422 FARE_NOT_CHANGEABLE`.** If the card could
release one, it would be a second door around beat 6: the agent would route
around the gate, the teach arc would never fire, and NOTHING would fail — the
card is gorgeous, the write lands, the room applauds, and the demo proves the
opposite of its claim.

Aeronova's version of this separation is **stronger than logistics'**, and
worth understanding before anyone "simplifies" it. Logistics' gate is on an
AMOUNT, so the option the caller names decides whether the gate fires — which is
why failure-modes § 12 tells that skin never to let the agent pick the option.
Aeronova's gate is a property of the **FARE**, not of the amount, so no choice of
option can slip past it: every option on a non-changeable booking is refused,
which is exactly what `authorizations/route.test.ts` asserts (it walks all of
them, discovered from the live ledger, rather than hardcoding one).

Two more properties the route keeps, from § 12:

- The card is only offered on an option the passenger is **already entitled** to
  take — `authorizableOptions()` in `data/fare-rules.ts` returns exactly those.
- …and only when money is actually due. An involuntary rebooking after a
  cancellation costs `$0`, and asking for a card to move `$0` is a formality
  dressed up as an authorization (logistics' `absorb` costing `$0` is the same
  bug). `amountDueUsd > 0` is load-bearing in that filter, and the card must say
  "nothing is due on this one" rather than render a box that cannot succeed. The
  route enforces the same thing: a `$0` authorization is `422 NOTHING_DUE`.

**And the two write routes are complementary, which is what stops the card being
decoration.** `POST /bookings/[id]/change` commits only when nothing is due;
when money IS due it stops at `402 PAYMENT_REQUIRED` and names the amount.
`POST /authorizations` is therefore the ONLY path that commits a paid change,
because it is the only one the card confirmation reaches. If the ordinary change
route could take money on its own, beat 3a's card would be a decorative step the
demo could skip and nothing would fail.

**The record beat 3a runs on is `bkg-av7702`** — Camila's Buenos Aires trip on a
Flex fare. Chosen because a Flex fare charges no change fee, so the amount due is
purely a fare DIFFERENCE: the passenger is paying for a better seat, not a
penalty, which is the version of this the room finds sympathetic rather than
annoying.

---

## Beat 3c — the four levers

The rebooking search **everyone in the room has personally used**, which is the
argument for it: nobody has to be told what a departure-window filter is.

`data/rebooking-levers.ts` holds ONE normalized record that feeds the confirm
card's chips, the pushed URL, the page's pipeline and the tool schema:

| Lever    | Page vocabulary                               | Means                                           | "not pulled" |
| -------- | --------------------------------------------- | ----------------------------------------------- | ------------ |
| `window` | `morning`, `afternoon`, `evening`             | departs 00:00–11:59 / 12:00–17:59 / 18:00–23:59 | `all`        |
| `stops`  | `nonstop`, `one_stop`, `two_plus`             | 0 / 1 / 2+ stops                                | `all`        |
| `cabin`  | `economy`, `premium`, `business`              | the cabin the option is priced in               | `all`        |
| `sort`   | `price_asc`, `depart_soonest`, `duration_asc` | cheapest / soonest / shortest first             | `all`        |
| `top`    | a positive integer                            | truncate to N rows                              | `0`          |

Every lever is REQUIRED with its "not pulled" sentinel INSIDE the enum, for the
reason logistics measured: a model facing an OPTIONAL enum fills it anyway, and
the maneuver lands on an empty board with four confidently tinted controls.
`normalizeLevers` drops the sentinel by construction (it is not in the page's
vocabulary), so an unset lever draws no chip and writes no query param.

**`applyLevers` publishes TWO lengths from ONE pipeline** — `matching` (levers
applied) and `visible` (`matching` truncated to `top`). The page's "Top 5 of 18"
caption, the rows and the readable all read those, so the caption can never say
the filters did nothing while the rows say they did (the commerce bug).

**The seed is fat on purpose.** The cancelled return `AV1466` (LIM→SCL) carries
**30 rebooking options** across three windows, three stop-buckets and three
cabins. The beat's own lever set — `window=evening`, `stops=nonstop`,
`sort=price_asc`, `top=5` — leaves **10 matching rows**, truncated to 5. Logistics'
`suggestions.ts` records why that matters: a one-row board is indistinguishable
from a broken filter on stage. `rebooking-options.test.ts` asserts the ≥5 floor
directly, so a future reseed that thins the board fails a test instead of a demo.

---

## Beat 4 — the preferences

Camila's seat and fare preferences. Four clauses, every one of which visibly
changes an answer, and every one of which the substrate carries the fields for:

> Seat me on the **aisle**, **forward of the wing** where there is one.
> **Never Basic Economy**, even when it is cheaper.
> Quote every departure in **my home time** (America/Santiago), not the local
> airport clock.
> When you summarize my trips, lead with **whatever is disrupted**.

| Clause          | Field it needs                                        | Where                        |
| --------------- | ----------------------------------------------------- | ---------------------------- |
| aisle / forward | `columnKind()` + `isForwardCabin()`, `availableSeats` | `data/handling.ts`, `Flight` |
| never Basic     | `fareBrand` on every option                           | `RebookingOption`            |
| home time       | `homeTimezone` on the traveler; offsets on every ISO  | `Traveler`, `Flight`         |
| disrupted first | `status` + `delayMinutes` + `scheduleChangeMinutes`   | `Flight`                     |

The summary tool needs a `note` slot where the agent NAMES the preference it
applied, or the beat is invisible — the audience just sees a normal answer.
Seeded in `intelligence/seed-memories.ts`, a later slot.

---

## Beat 5 — the stored procedure

Trigger, one vague sentence: **"My flight home just got cancelled — handle it."**

The record is `bkg-av1466` — Camila's **return** leg, `AV1466` LIM→SCL, status
`cancelled`. Three ordered writes, each visible on the trip record:

1. **Rebook onto the best option** — `POST /bookings/[id]/change`. The flight is
   cancelled, so the change is **involuntary**: free, on any fare, by rule. That
   is what keeps beat 5 clear of beat 6's gate — see below.
2. **Reseat to preference** — `POST /bookings/[id]/seat`, preference from
   `SEAT_PREFERENCES` (`aisle`, `window`, `forward-cabin`, `exit-row`). The
   server picks the best available seat matching it and says which rule it
   matched; a seat the flight does not have free is refused rather than
   invented.
3. **Notify a downstream party** — `POST /bookings/[id]/notify`, party from
   `NOTIFY_PARTIES` (`arrival-pickup`, `hotel`, `travel-companion`,
   `employer-travel-desk`). The contact is copied off the BOOKING, never taken
   from the caller — a client-supplied name is a name the model spelled. A party
   the booking has no contact for is refused, so the app never claims to have
   told someone it does not know how to reach.

Every one of the three appends a `TripLogEntry`, and the notify entry carries a
FORCED `🚨` marker (`markNote`) so the change is un-skimmable on a projector. A
model that phrases it plainly does not get to cost the beat its only visible
artifact.

**This vocabulary is GIVEN to the agent** — enumerate it on the tool schemas, in
the prompt, in the refusal bodies. That is the exact opposite of beat 6's, and
the contrast is the point: there is nothing to discover here; the whole claim is
that it already knows the procedure.

The two vocabularies live in **two modules that share no token** —
`data/handling.ts` (given) vs `data/fare-waiver-codes.ts` (withheld). Neither
file contains a word from the other: `handling.ts` never says "waiver",
"exception", "schedule change", "medical", "bereavement" or "military";
`fare-waiver-codes.ts` never says "notify", "party", "seat", "aisle", "hotel" or
"pickup". A future edit reaching for "the codes file" cannot import the withheld
one into `tools.tsx` by accident.

**Distractors** already exist in the skin and must stay registered: `showFlight`,
`showLoyalty`, `showRedemptions`, `trackBaggage`, `showSeatMap`,
`showBoardingPass`. "It picked the right three" only means something with those
in the room.

The prompt must say plainly that this is a DIFFERENT procedure from beat 6's
fare-exception arc, and that it must not offer to record anything.

### Why beat 5 can never touch beat 6's gate

`checkFareChange()` short-circuits on **involuntary** disruption before it looks
at the fare at all: a `cancelled` flight, or a schedule change at or past the
4-hour involuntary threshold, permits a free change on ANY fare, including Basic
Economy. That is the real industry rule, and it is also what keeps the two beats
from colliding: beat 5's booking is cancelled and therefore ungated, and beat 6's
gated bookings are voluntary changes on intact flights. `fare-rules.test.ts`
pins both directions.

---

## Beat 6 — the teachable gate ⭐

The most important design decision here, so it is written out in full.

### The gate

`POST /api/airline/v1/bookings/[id]/change` reissues a booking onto another
option. Refusal: **`422 FARE_NOT_CHANGEABLE`**.

> "AV3PL9 is ticketed in Basic Economy. Changes are not permitted on this fare —
> this ticket cannot be reissued to another flight."

It names the **fare condition** and nothing else. It does not name the way
through: not the word "exception", not a category, not "ask an agent". That is
the thing the passenger must demonstrate and the agent must learn.

**Every figure is recomputed server-side.** A client-supplied fare difference or
fee is ignored, or the gate is theater.

### The unlock

`POST /api/airline/v1/fare-exceptions` files an exception against a booking
under a waiver category, **justified by documentation the passenger supplies**
(`documentReference`, required non-empty — a filing with nothing behind it is
refused with `MISSING_DOCUMENTATION`, which names no categories).
`POST /api/airline/v1/fare-exceptions/[id]/approve` approves it and links it to
the booking, which is what lifts the gate — **provided the category is
justifying AND the booking's record actually supports it.**

**Justifying categories (4) — the real industry ones:**

| Code                        | Means                                                    |
| --------------------------- | -------------------------------------------------------- |
| `SCHEDULE_CHANGE_TRIGGERED` | The airline moved the flight after the ticket was issued |
| `MEDICAL_DOCUMENTED`        | A documented medical reason, certificate on file         |
| `BEREAVEMENT_DOCUMENTED`    | A documented bereavement                                 |
| `MILITARY_ORDERS`           | Change compelled by military orders                      |

**Decoy categories (3) — file honestly, record honestly, unlock NOTHING.** They
are strong precisely because they are what everyone actually tries:

| Code               | Means                                 | Why it is the tempting one                                                            |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `CHANGED_PLANS`    | The passenger's plans changed         | The literal truth of every voluntary change, and the first thing anyone types         |
| `FOUND_LOWER_FARE` | A cheaper fare appeared               | The most common real-world reason, and the one no airline honours                     |
| `ELITE_COURTESY`   | Courtesy for a tier member (recorded) | Camila is Gold and Tomás is Platinum — "just ask, we're elite" is the room's instinct |

**Uncatalogued codes** → `422 INVALID_EXCEPTION_CODE`, **without enumerating the
valid set**. Guessing stays expensive.

### Grounding — why a justifying code is not enough on its own

An exception lifts the gate only when its category **matches the circumstance
the booking's record actually documents**:

```ts
exceptionLifts(code, booking) =>
  isJustifyingExceptionCode(code) && GROUND_BY_CODE[code] === booking.waiverGround
```

That is both the honest reading — you cannot claim a schedule-change waiver on a
flight that never changed, or a medical waiver with no certificate on file — and
the thing that makes the two gated bookings genuinely unlike each other. Without
grounding, a demonstration on the first booking could be replayed on the second
as a memorized literal (`SCHEDULE_CHANGE_TRIGGERED` would work on both) and the
"different case, unaided" claim would be theater. With grounding, the learned
procedure has to be **"read what the booking documents, file the category that
matches it, approve it, then retry the change"** — which is a procedure, not a
string.

**The ground never reaches the wire as a token.** `Booking.waiverGround` is
server-side only and `store.snapshot()` strips it; the ledger carries
`fareNotes`, human prose the passenger reads on their own booking
("Aeronova moved AV2214 by 3h 10m on 2 Jul; notice AV-SC-88214 is on file").
`store.test.ts` pins the strip — it is a vocabulary channel the failure-modes
list does not name, because no other skin has a grounded gate.

**Neither the file route nor the approve route ever says whether the exception
lifts.** A `{ lifts: true }` in a 201 body would hand over the entire catalogue
one probe at a time. The only way to find out is to retry the change, which is
exactly the loop the passenger demonstrates. `fare-exceptions/route.test.ts`
asserts the absence.

### The seeded gated bookings

Three, not two. Two so the case taught on stage and the unaided replay are
different people; a third so the decoys are **real** rather than theoretical.

| Booking      | Ref      | Traveler          | Flight         | Fare                  | Documents                                | Releases with               |
| ------------ | -------- | ----------------- | -------------- | --------------------- | ---------------------------------------- | --------------------------- |
| `bkg-av2214` | `AV3PL9` | **Tomás Aguirre** | AV2214 LIM→MIA | Basic Economy         | a 3h 10m schedule change, notice on file | `SCHEDULE_CHANGE_TRIGGERED` |
| `bkg-av0918` | `AV8RT4` | **Inés Vidal**    | AV0918 SCL→MAD | Promo, non-refundable | a physician's certificate on file        | `MEDICAL_DOCUMENTED`        |
| `bkg-av1188` | `AV5KD1` | **Camila Rojas**  | AV1188 SCL→GRU | Basic Economy         | **nothing**                              | **nothing — by design**     |

Different traveller, route, fare brand, reason and releasing category on each.
The 3h 10m schedule change on `AV3PL9` is deliberately **below** the 4-hour
involuntary threshold: it is a real grievance the automatic rule does not cover,
which is precisely when a human files an exception.

`bkg-av1188` is the demo's honest wall. Camila simply wants to leave a day
earlier on a Basic Economy ticket. `CHANGED_PLANS` and `FOUND_LOWER_FARE` are
literally true, file cleanly, appear on the record — and change nothing. So does
`ELITE_COURTESY`. A justifying category filed on it does not lift it either,
because there is nothing on the record to ground it. This is the case that makes
"the decoys are real" a fact rather than a claim in a README.

Both gated cases are **computed, never asserted**: `blockedByFareRules()` derives
them from the same `checkFareChange()` the server runs, so the passenger-facing
exception form can never advertise a booking the gate would not actually refuse.

### ⚠️ The vocabulary is WITHHELD FROM THE AGENT

`data/fare-waiver-codes.ts` carries the full warning; this is the summary. It
leaks through **five** channels and closing four is closing none:

1. a `useAgentContext` readable,
2. a `z.enum(FARE_WAIVER_CODES)` on the filing tool's schema,
3. the tool's own `description`,
4. the prompt,
5. the refusal body.

Take a free `z.string()` on the code parameter and state the withholding in its
`.describe()`. This INVERTS the enumerate-every-closed-set rule followed
everywhere else — for a gate, reaching the model is the defect.

`eslint.config.mjs`'s `withheldGateVocabulary` rule catches only channels 2 and 3
(the two that appear as identifiers), and **its `files` glob does not list
`airline`.** The slot that lands `src/skins/airline/tools.tsx` and
`src/skins/airline/agent.ts` MUST append both to that glob — restating the
LOCK_SKIN selectors in the same block, because flat-config `rules` are replaced
rather than merged — or nothing checks Aeronova. Verify with
`npx eslint --print-config src/skins/airline/tools.tsx` and COUNT the selectors.
Channels 1, 4 and 5 are a grep-and-read.

**Build the FORM. It is the sixth channel and it must be OPEN.**
`FARE_WAIVER_CODE_LABELS` is reserved for a human-facing fare-exception form on
the trip page: the passenger picks a category, and the agent watches them do it.
The menu must list justifying categories and decoys **together, unmarked, in
catalogue order** — a form that flags the working ones turns the demonstration
into a guided tour. And the recorder must log the code as DATA exactly as the
passenger entered it, decoy included; a recorder that quietly corrected them
would report a procedure nobody demonstrated.

---

## Beat 3d — the document the ledger cannot supply

**A hotel confirmation**, chosen over a corporate travel policy, and the reason
is the test the beat actually has to pass: does the artifact say something
**neither source alone could say**?

- A corporate travel policy mostly restates preferences (cabin caps, preferred
  carriers) that beat 4's memory already carries. Ingesting it would produce a
  brief the agent could have written from what it already knew.
- A hotel confirmation carries a **last check-in time** and a **cancellation
  deadline** that exist nowhere in Aeronova's world — and the flight's arrival
  time exists nowhere in the hotel's. The brief's headline sentence is the
  collision of the two: _"AV1423 now lands 23:00; Casa Miraflores stops taking
  arrivals at 22:30."_ That sentence is unforgeable proof the file was read,
  because it cannot be derived from either side on its own.

`GET /hotel-confirmation?booking=AV7QK2` generates the PDF from
`data/hotel-confirmations.ts` + `data/hotel-confirmation-pdf.ts` (bytes from
`@/shell/documents`, content only here). `POST /briefs` files the durable
**Trip Brief**, which lives on the trip record and not on the thread — delete the
whole conversation and the brief is still there.

**Fields are split by WHO OWNS THE FACT** (the logistics `oldRateUsdPerKg`
lesson, which went wrong in three directions at once):

| Owner            | Fields                                                                                                          | Rule                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the **document** | `hotelName`, `confirmationNumber`, `address`, `lastCheckInLocal`, `cancellationDeadlineLocal`, `nightlyRateUsd` | model-authored — only a reader of the attachment knows them. That IS the beat's proof.                                                                                            |
| the **ledger**   | `bookingRef`, `travelerName`, `arrivalStation`, `arrivalLocal`                                                  | the route OVERWRITES from the ledger on a unique match, DROPS them when there is no match, and reports both lists so the tool can tell the agent rather than silently overrule it |
| **derived**      | `arrivesAfterLastCheckIn`                                                                                       | tri-state `true \| false \| null` — `null` when arrival is unknown, never `false`, per failure-modes § 1                                                                          |

`??` is not settlement: it repairs the under-filled case and stores the wrong
one.

**Scope the match by what the document is a statement ABOUT.** A hotel
confirmation is about ONE traveler arriving in ONE city on ONE date, so that is
the match key — unique on every seeded row. Matching on city alone would hit
both of Camila's Lima legs and look unsettleable.

**And every row belongs to the party the document is addressed to.**
`hotelConfirmationFor()` keys the entry by booking reference AND re-checks the
entry's city against the booking's live destination, DROPPING the entry rather
than misattributing it when a reseed moves the flight. Commerce shipped one
hard-coded row on every vendor's price sheet and invented a supplier
relationship that does not exist; this is that lesson applied.

---

## The route tree

```
GET  /api/airline/v1/ledger                        one snapshot: profile, travelers, bookings, flights, options, exceptions, briefs
GET  /api/airline/v1/bookings/[id]                 one booking, resolved by id or PNR
GET  /api/airline/v1/bookings/[id]/options         that booking's rebooking options, levers applied from the query string
POST /api/airline/v1/bookings/[id]/change          BEAT 5 step 1 + BEAT 6 GATE — reissue onto an option; 422 FARE_NOT_CHANGEABLE
POST /api/airline/v1/bookings/[id]/seat            BEAT 5 step 2 — reseat to a preference the server resolves
POST /api/airline/v1/bookings/[id]/notify          BEAT 5 step 3 — notify a downstream party, contact copied off the booking
POST /api/airline/v1/authorizations                BEAT 3a — card-confirmed paid change; re-runs the SAME fare gate
POST /api/airline/v1/fare-exceptions               BEAT 6 unlock, step 1 — file under a category + documentation
POST /api/airline/v1/fare-exceptions/[id]/approve  BEAT 6 unlock, step 2 — approve and link; never says whether it lifts
GET  /api/airline/v1/hotel-confirmation            BEAT 3d — the attached PDF, generated per booking
POST /api/airline/v1/briefs                        BEAT 3d — file the durable Trip Brief; ledger facts settled server-side
POST /api/airline/v1/dev/reset                     presenter reset — restores the account (memory re-seed: later slot)
```

Two conventions every one of them shares:

- **`[id]` accepts a booking id OR a PNR**, and a PNR held by more than one leg
  is `409 AMBIGUOUS_REFERENCE` with the candidate ids, never a silent pick.
  Camila's outbound and her return both sit under `AV7QK2`, which is how a real
  reservation works — so "change AV7QK2" is a genuinely ambiguous instruction,
  and taking the first match would reissue the wrong leg while reporting success.
- **No route trusts a caller's arithmetic.** Fare differences, change fees and
  totals are recomputed from the ledger on every write; a figure in the body is
  ignored outright, or the gate is theater.

---

## What this slot did NOT build — ALL OF IT HAS SINCE LANDED

This section was the substrate slot's hand-off list. Every row is now built; it is
kept as the record of what "correct wiring plus nothing else" was still missing,
which is the most useful thing about a retrofit
(`.claude/skills/reskin/demo-beats.md` § "Which skin to copy for what" points at
the three retrofits for exactly this reason).

| Was deferred                                                      | Which beat it finished                                       | Now                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `tools.tsx`, `agent.ts`, `suggestions.ts`, pages, components      | all of them — the substrate had no UI                        | ✅ shipped                                                                        |
| Route + per-page `useAgentContext` readables                      | 3b, which airline had never hit                              | ✅ `layout.tsx` + all five pages; `readables.test.tsx` guards omission            |
| `intelligence/seed-memories.ts` + `forget-memories.ts`            | 4, 5 and the re-arming half of the reset                     | ✅ both, scoped `user` (never `project` — see demo-beats.md § Seeding memories)   |
| `intelligence/user-id.ts` + `identifyUser` in `agent-registry.ts` | per-user memory scoping                                      | ✅ plus `useRuntimeProperties` and NO `RuntimeProviders` (no context to read)     |
| The human-facing fare-exception FORM                              | 6 — a withheld catalogue with no form is an unlearnable gate | ✅ `components/fare-exception-form.tsx`                                           |
| `attach-hotel-confirmation.ts` over `@/shell/attach`              | 3d's pill and paperclip                                      | ✅ plus `CanvasSurface` + the server tool `render_trip_brief`                     |
| Migrating the pages off `useAirlineData` onto `/ledger`           | the two-substrates risk in point 5 below                     | ✅ `useAirlineData` and `data/use-data.ts` are DELETED; `useAirlineLedger()` only |

The three traps this section flagged, and how each resolved:

1. **`eslint.config.mjs`'s `withheldGateVocabulary` glob did not list airline.**
   ✅ Both `src/skins/airline/tools.tsx` and `src/skins/airline/agent.ts` are in
   it now, and airline is in the `statusKeyedTerminalRender` glob too — both
   restating the LOCK_SKIN selectors, per the flat-config replace-not-merge rule.
   Do not verify by counting selectors; the resolved-selector table in
   `src/shell/skins-config.test.ts` asserts the list by name.
2. **`LINTED_SKIN_IDS` already lists airline** — still true, still worth checking
   rather than trusting; `skins-config.test.ts` proves it mechanically.
3. **The reset route said `memoryBeats: "unarmed"` on purpose.** ✅ Gone in the same
   change that added the seed-memories module, exactly as instructed — the reset now
   forgets and re-seeds.

---

## Where the passenger framing genuinely fights the beats

Stated plainly rather than papered over, because the next slot inherits these.

1. **Beat 3c's board is options, not records.** Every other demo-complete skin
   filters a queue of WORK. A passenger has no queue, so the levers filter
   **flight search results** instead. That is a better-known control surface, not
   a worse one — but the rows are candidates rather than obligations, so a page
   that copies commerce's "worklist" chrome verbatim will read wrong. Design it
   as a search results list.

2. **The money is small, and that is fine — but say the number.** A fare
   difference is hundreds of dollars, not the five figures a freight mitigation
   moves. The gate here is not on an amount at all (it is on the fare's
   conditions), which sidesteps the problem logistics has, but beat 3a's card
   still authorizes a modest sum. The presenter should read it out.

3. **The account has three travelers, and that is the one place the framing
   stretches.** A passenger with only their own bookings cannot host beat 6's
   "different case, unaided" requirement, because a single traveler's trips tend
   to share one fare and one reason. Saved travelers on a profile is an ordinary
   airline feature and the stretch is small — but it is a stretch, and a later
   slot should make the profile visibly Camila's (her name on the account, the
   companions clearly hers) rather than letting the trips page read as an agency
   console. **This is the one thing to watch for the reframe creeping back in.**

4. **Beat 4's "disrupted first" clause needs a disruption to survive the demo.**
   Beat 5 resolves the cancelled return by rebooking it. If beat 4 runs after
   beat 5 in the deck, the disruption it is supposed to lead with is gone. Either
   order beat 4 before beat 5 in the pill list, or leave `bkg-av1423`'s delay
   standing (beat 5 does not touch it) — the seed keeps that delay for exactly
   this reason.

5. **Two substrates, one passenger — they must not disagree on stage.** Camila's
   AV1423 exists in BOTH `use-data.ts` (in-memory, drives the current pages) and
   this REST ledger. The seed here is written to AGREE with the in-memory one:
   same flight number, route, cities, aircraft, gate, times, `delayed` status and
   a 55-minute delay. Everything the REST substrate adds is on records the
   in-memory store has never heard of (the return leg, the companions' bookings,
   the option board). **A later slot that migrates the pages must migrate BOTH
   readings** — and until it does, do not "improve" either seed's AV1423 without
   changing the other.
