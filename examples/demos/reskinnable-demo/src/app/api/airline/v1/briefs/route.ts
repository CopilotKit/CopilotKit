import * as store from "@/skins/airline/data/store";
import { jsonError, readJsonObject } from "@/skins/airline/data/route-helpers";
import {
  arrivesAfterLastCheckIn,
  clockMinutes,
  effectiveArrival,
} from "@/skins/airline/data/hotel-confirmations";
import type {
  Booking,
  Flight,
  Traveler,
} from "@/skins/airline/data/trip-types";

/**
 * BEAT 3d — file the durable Trip Brief from an ingested hotel confirmation.
 *
 * ⚠️ FIELDS ARE SPLIT BY WHO OWNS THE FACT, and the server SETTLES its own — in
 * EVERY direction. This is logistics' `oldRateUsdPerKg` lesson, which went wrong
 * three ways at once on a single optional parameter:
 *
 *  - OVER-FILLED: the model copies a figure it had no business supplying, and
 *    the artifact contradicts the document it was filed from.
 *  - UNDER-FILLED: the model omits a fact the ledger DOES hold, and the card
 *    reports an absence the app can disprove.
 *  - WRONG: the model's reading is stored verbatim and renders a number nobody
 *    can reproduce.
 *
 * Prompt wording closes none of them. So:
 *
 *  - The DOCUMENT's facts stay model-authored. The hotel, the confirmation
 *    number, the last check-in and the cancellation deadline exist ONLY in the
 *    attachment, and only a reader of it knows them. That is the beat's proof
 *    and it must not be settled away.
 *  - The LEDGER's facts are OVERWRITTEN from the ledger on a unique match,
 *    DROPPED to `null` when there is no unique match (absence of the row IS the
 *    answer), and reported in `settled` / `unmatched` so the tool can TELL the
 *    agent rather than silently overrule it.
 *
 * `??` is not settlement: it repairs the under-filled case and stores the wrong
 * one.
 *
 * ⚠️ SCOPE THE MATCH BY WHAT THE DOCUMENT IS A STATEMENT ABOUT. A hotel
 * confirmation is about ONE guest arriving in ONE city on ONE date, so that is
 * the key — and it is unique on every seeded row. Matching on city alone would
 * hit both of Camila's Lima legs and look unsettleable; matching on the PNR
 * would be worse, because two of her bookings share one.
 */

interface DocumentFacts {
  hotelName: string;
  confirmationNumber: string;
  address: string;
  lastCheckInLocal: string;
  cancellationDeadlineLocal: string;
  nightlyRateUsd: number;
  /** The match key, all three read off the document. */
  guestName: string;
  city: string;
  checkInDate: string;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * A money figure the document states, or `null`.
 *
 * REFUSES rather than coerces, for the same reason `parseTopLever` does: a rate
 * the app cannot read must not become a rate it prints. `Number("")` is `0` and
 * `Number(null)` is `0`, so a bare `Number(...)` would file a $0 room.
 */
const money = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 ? Math.round(value * 100) / 100 : null;
};

/** The calendar date of a flight's arrival, in the arrival airport's clock. */
const arrivalDateOf = (flight: Flight): string =>
  flight.arrivalLocal.trim().slice(0, 10);

interface Match {
  booking: Booking;
  flight: Flight;
  traveler: Traveler;
}

/**
 * Every booking the document could be about. Returns ALL matches so the caller
 * can tell "no match" from "ambiguous" — both are reasons to drop the ledger
 * fields, but only one of them means the ledger has nothing to say.
 */
function matchesFor(facts: DocumentFacts): Match[] {
  const found: Match[] = [];
  for (const booking of store.bookings()) {
    const flight = store.flightFor(booking);
    const traveler = store.travelerFor(booking);
    if (!flight || !traveler) continue;
    if (traveler.name !== facts.guestName) continue;
    if (flight.destinationCity !== facts.city) continue;
    if (arrivalDateOf(flight) !== facts.checkInDate) continue;
    found.push({ booking, flight, traveler });
  }
  return found;
}

/**
 * The sentence the agent reads out.
 *
 * Derived in all three states, and the unmatched one says the check could not be
 * made rather than reassuring anybody. A brief whose headline quietly omitted
 * the collision would look identical to one where there was none — which is the
 * only failure mode this beat cannot survive.
 */
function headlineFor(
  facts: DocumentFacts,
  match: Match | null,
  arrivalClock: string | null,
  collides: boolean | null,
): string {
  if (!match || !arrivalClock || collides === null) {
    return (
      `No Aeronova booking matches this ${facts.hotelName} reservation, so the ` +
      `arrival could not be checked against its ${facts.lastCheckInLocal} last ` +
      `check-in.`
    );
  }
  const flightNumber = match.flight.flightNumber;
  if (collides) {
    return (
      `${flightNumber} gets into ${facts.city} at ${arrivalClock}; ` +
      `${facts.hotelName} stops taking arrivals at ${facts.lastCheckInLocal} — ` +
      `the room needs to be held.`
    );
  }
  return (
    `${flightNumber} gets into ${facts.city} at ${arrivalClock}, inside ` +
    `${facts.hotelName}'s ${facts.lastCheckInLocal} last check-in.`
  );
}

/** Every brief filed so far, newest first. */
export const GET = async () => Response.json({ briefs: store.briefs() });

export const POST = async (req: Request) => {
  const body = await readJsonObject(req);
  if (!body) return jsonError("BAD_REQUEST", "A JSON body is required.", 400);

  const facts: DocumentFacts = {
    hotelName: text(body.hotelName),
    confirmationNumber: text(body.confirmationNumber),
    address: text(body.address),
    lastCheckInLocal: text(body.lastCheckInLocal),
    cancellationDeadlineLocal: text(body.cancellationDeadlineLocal),
    nightlyRateUsd: money(body.nightlyRateUsd) ?? 0,
    guestName: text(body.guestName),
    city: text(body.city),
    checkInDate: text(body.checkInDate),
  };

  const missing: string[] = (
    [
      ["hotelName", facts.hotelName],
      ["confirmationNumber", facts.confirmationNumber],
      ["lastCheckInLocal", facts.lastCheckInLocal],
      ["guestName", facts.guestName],
      ["city", facts.city],
      ["checkInDate", facts.checkInDate],
    ] as [string, string][]
  )
    .filter(([, value]) => value === "")
    .map(([field]) => field);
  if (facts.nightlyRateUsd <= 0) missing.push("nightlyRateUsd");

  if (missing.length > 0) {
    // Named rather than summarised: this is the one refusal the agent can act
    // on, because every listed field is something it can go back and re-read off
    // the attachment.
    return jsonError(
      "INCOMPLETE_DOCUMENT",
      `The confirmation is missing: ${missing.join(", ")}.`,
      422,
    );
  }
  if (clockMinutes(facts.lastCheckInLocal) === null) {
    return jsonError(
      "INCOMPLETE_DOCUMENT",
      "lastCheckInLocal has to be a clock time like 22:30.",
      422,
    );
  }

  // ── SETTLEMENT ───────────────────────────────────────────────────────────
  const matches = matchesFor(facts);
  const match = matches.length === 1 ? matches[0] : null;
  const arrival = match ? effectiveArrival(match.flight) : null;
  const collides = arrivesAfterLastCheckIn(arrival, facts.lastCheckInLocal);

  const LEDGER_FIELDS = [
    "bookingRef",
    "travelerName",
    "arrivalStation",
    "arrivalLocal",
  ] as const;

  const brief = store.fileTripBrief({
    ...facts,
    bookingRef: match?.booking.reference ?? null,
    travelerName: match?.traveler.name ?? null,
    arrivalStation: match?.flight.destination ?? null,
    // The SCHEDULED arrival timestamp, with its offset — the raw ledger fact.
    // `arrivesAfterLastCheckIn` is the one that accounts for today's delay, so
    // the two are not two spellings of the same thing.
    arrivalLocal: match?.flight.arrivalLocal ?? null,
    arrivesAfterLastCheckIn: collides,
    headline: headlineFor(facts, match, arrival?.clock ?? null, collides),
  });

  return Response.json(
    {
      brief,
      // Told, never assumed. The tool reads these back to the agent so it knows
      // which of its readings the ledger overruled and which it could not check.
      settled: match ? [...LEDGER_FIELDS] : [],
      unmatched: match ? [] : [...LEDGER_FIELDS],
      matchCount: matches.length,
    },
    { status: 201 },
  );
};
