/**
 * In-memory, seed-backed store for Aeronova's traveler profile.
 *
 * Seeded once at module init and deep-cloned so mutations never bleed back into
 * the imported seed. All mutations live for the server process only; restarting
 * the dev server resets to seed. Intentional demo behavior.
 *
 * ⚠️ THIS IS ADDITIVE. `use-data.ts` (`useAirlineData`) — the concierge's
 * in-memory React store — is untouched and still drives the trip, loyalty and
 * disruption pages. A later slot migrates those consumers. Until it does, both
 * substrates are live and a change to either must not assume the other moved;
 * `trip-seed.ts`'s header says which fields are deliberately identical.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"`.
 */

import { isValidExceptionCode } from "./fare-waiver-codes";
import {
  isNoticeTemplate,
  isNotifyParty,
  isSeatPreference,
  markNote,
  pickSeatForPreference,
} from "./handling";
import type { SeatPreference } from "./handling";
import {
  SEED_NOW,
  seedBookings,
  seedFlights,
  seedOptions,
  seedProfile,
  seedTravelers,
} from "./trip-seed";
import type {
  Booking,
  BookingDto,
  FareException,
  Flight,
  PassengerNotice,
  RebookingOption,
  Reissue,
  TravelProfile,
  Traveler,
  TripBrief,
  TripLogEntry,
} from "./trip-types";

interface DB {
  now: string;
  profile: TravelProfile;
  travelers: Traveler[];
  flights: Flight[];
  bookings: Booking[];
  options: RebookingOption[];
  /**
   * BEAT 6 and BEAT 3d records both start EMPTY and have no seed key.
   *
   * A seeded exception would open the demo with the gate already lifted, and a
   * seeded brief would be an artifact with no document behind it — precisely
   * the thing beat 3d exists to disprove. Keeping them off the seed also means
   * a clone cannot silently leave either `undefined`.
   */
  exceptions: FareException[];
  briefs: TripBrief[];
}

const freshDb = (): DB => ({
  now: SEED_NOW,
  profile: structuredClone(seedProfile),
  travelers: structuredClone(seedTravelers),
  flights: structuredClone(seedFlights),
  bookings: structuredClone(seedBookings),
  options: structuredClone(seedOptions),
  exceptions: [],
  briefs: [],
});

const db: DB = freshDb();

let idCounter = 0;
const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${idCounter++}`;

export const reset = (): void => {
  const fresh = freshDb();
  db.now = fresh.now;
  db.profile = fresh.profile;
  db.travelers = fresh.travelers;
  db.flights = fresh.flights;
  db.bookings = fresh.bookings;
  db.options = fresh.options;
  db.exceptions = [];
  db.briefs = [];
  // Beat 5's three writes need no line of their own: `reissued`, `seat`,
  // `notices` and `log` all live ON the booking, and the seed carries none of
  // them, so re-cloning above already drops every one. Said out loud because the
  // opposite is the demo-destroying half — a trip that opens with last run's 🚨
  // notice already on AV7QK2 makes the stored procedure look like it ran before
  // anyone asked.
  idCounter = 0;
};

// ---- Reads ----------------------------------------------------------------
export const now = (): string => db.now;
export const profile = (): TravelProfile => db.profile;
export const travelers = (): Traveler[] => db.travelers;
export const flights = (): Flight[] => db.flights;
export const bookings = (): Booking[] => db.bookings;
export const options = (): RebookingOption[] => db.options;
export const exceptions = (): FareException[] => db.exceptions;
export const briefs = (): TripBrief[] => db.briefs;

export const findFlight = (id: string): Flight | undefined =>
  db.flights.find((f) => f.id === id);
export const findTraveler = (id: string): Traveler | undefined =>
  db.travelers.find((t) => t.id === id);
export const findException = (id: string): FareException | undefined =>
  db.exceptions.find((e) => e.id === id);

/**
 * A booking by its id OR its PNR.
 *
 * Both, because the passenger reads "AV7QK2" off their own screen and every
 * agent-facing surface will hand that back — while the ledger's own links carry
 * `bkg-…`. Two of Camila's bookings share the PNR `AV7QK2` (an outbound and its
 * return, which is how a real reservation works), so a PNR lookup returns the
 * FIRST match and callers that must be exact use the id. The change route says
 * so in its refusal rather than picking silently.
 */
export const findBooking = (ref: string): Booking | undefined =>
  db.bookings.find((b) => b.id === ref) ??
  db.bookings.find((b) => b.reference === ref);

/** Every booking sharing a PNR — how a caller detects the ambiguity above. */
export const bookingsByReference = (reference: string): Booking[] =>
  db.bookings.filter((b) => b.reference === reference);

export type BookingLookup =
  | { ok: true; booking: Booking }
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "AMBIGUOUS_REFERENCE"; matches: string[] };

/**
 * The lookup every WRITE route uses. Unlike `findBooking` it refuses to guess.
 *
 * Camila's outbound and her return share the PNR `AV7QK2`, which is how a real
 * reservation works — so "change AV7QK2" is a genuinely ambiguous instruction,
 * and silently taking the first match would reissue the wrong leg while
 * reporting success. A write that cannot tell which record was meant says so and
 * names the candidates; an exact id always wins.
 */
export const resolveBooking = (ref: string): BookingLookup => {
  const trimmed = ref.trim();
  const byId = db.bookings.find((b) => b.id === trimmed);
  if (byId) return { ok: true, booking: byId };
  const matches = bookingsByReference(trimmed);
  if (matches.length === 1) return { ok: true, booking: matches[0] };
  if (matches.length > 1) {
    return {
      ok: false,
      error: "AMBIGUOUS_REFERENCE",
      matches: matches.map((b) => b.id),
    };
  }
  return { ok: false, error: "NOT_FOUND" };
};

export const flightFor = (booking: Booking): Flight | undefined =>
  findFlight(booking.flightId);

export const travelerFor = (booking: Booking): Traveler | undefined =>
  findTraveler(booking.travelerId);

/**
 * A booking as the LEDGER publishes it.
 *
 * ⚠️ `waiverGround` IS STRIPPED HERE, and that is a beat-6 vocabulary channel
 * the failure-modes list does not name, because no other skin has a GROUNDED
 * gate. The ground is a code-shaped token that maps one-to-one onto a justifying
 * category (`fare-waiver-codes.ts`), so publishing it on the wire would hand the
 * agent half the catalogue through the readable. The passenger reads the same
 * fact as prose, in `fareNotes`. `store.test.ts` pins the strip.
 */
export const toDto = (booking: Booking): BookingDto => {
  // `delete` on a shallow copy rather than a rest destructure: the destructured
  // form binds a variable nothing reads, which `no-unused-vars` flags, and the
  // usual answer — spelling out every field that DOES ship — is the worse trade
  // here. A field added to `Booking` and forgotten in a hand-written DTO
  // disappears from the ledger silently.
  const dto: BookingDto & { waiverGround?: Booking["waiverGround"] } = {
    ...booking,
  };
  delete dto.waiverGround;
  return dto;
};

/**
 * The whole ledger in one read.
 *
 * One snapshot rather than an endpoint per collection, for the reason commerce
 * and people both landed on: almost every surface here is cross-cutting — the
 * trip wall needs bookings AND flights AND travelers, the rebooking search needs
 * options AND the booking they belong to, the exception form needs all of those
 * — so N endpoints would mean N fetches, N loading states, and N chances for two
 * panels on the same screen to disagree. That matters more than usual here
 * because beat 3b asks the agent to describe exactly what the user can see.
 */
export const snapshot = () => ({
  now: db.now,
  profile: db.profile,
  travelers: db.travelers,
  flights: db.flights,
  bookings: db.bookings.map(toDto),
  options: db.options,
  exceptions: db.exceptions,
  briefs: db.briefs,
});

// ---- Mutations ------------------------------------------------------------

/**
 * Append to the trip log. Newest FIRST, so the trip page leads with what just
 * happened — which is the affordance beat 5 depends on.
 */
export const addLogEntry = (
  booking: Booking,
  entry: Omit<TripLogEntry, "id" | "createdAt">,
): TripLogEntry => {
  const filed: TripLogEntry = {
    ...entry,
    id: nextId("log"),
    createdAt: new Date().toISOString(),
  };
  booking.log = [filed, ...booking.log];
  return filed;
};

/**
 * BEAT 5, step 1 (and BEAT 6's gated write) — reissue a booking onto an option.
 *
 * The GATE is NOT here. Permission is decided by `checkFareChange` in
 * `fare-rules.ts` and every caller runs it first; this function only records a
 * decision that has already been made, so the two routes that write a reissue
 * (the ordinary change and the card-authorized one) cannot drift into two
 * different opinions about what was allowed.
 */
export const reissueBooking = (
  booking: Booking,
  option: RebookingOption,
  amountPaidUsd: number,
  permission: string,
): Reissue => {
  const reissue: Reissue = {
    optionId: option.id,
    flightNumber: option.flightNumber,
    origin: option.origin,
    destination: option.destination,
    departureLocal: option.departureLocal,
    arrivalLocal: option.arrivalLocal,
    cabin: option.cabin,
    amountPaidUsd,
    permission,
    reissuedAt: new Date().toISOString(),
  };
  booking.reissued = reissue;
  booking.status = "changed";
  // The seat does not travel with the passenger onto a different aircraft.
  // Cleared rather than kept, because a stale seat number on the new itinerary
  // is a confident falsehood the reseat step then appears to "confirm".
  booking.seat = null;
  addLogEntry(booking, {
    kind: "change",
    text: `Reissued onto ${option.flightNumber} (${option.origin}–${option.destination}), ${option.cabin}.`,
    author: "Aeronova",
  });
  return reissue;
};

/** The seats a booking can currently be moved to, on whatever it is now on. */
export const seatPoolFor = (booking: Booking): string[] => {
  if (booking.reissued) {
    return (
      db.options.find((o) => o.id === booking.reissued?.optionId)
        ?.availableSeats ?? []
    );
  }
  return flightFor(booking)?.availableSeats ?? [];
};

export type SeatResult =
  | { ok: true; seat: string; preference: SeatPreference }
  | { ok: false; error: "INVALID_PREFERENCE" | "NO_SEAT_AVAILABLE" };

/**
 * BEAT 5, step 2 — move the passenger to the best free seat matching a
 * preference.
 *
 * REFUSES rather than approximates. A reseat that quietly lands them in a middle
 * seat and reports success is exactly the confident falsehood this app fails
 * toward: the passenger keeps the seat they had and the caller says so out loud.
 */
export const reseatBooking = (
  booking: Booking,
  preference: string,
): SeatResult => {
  if (!isSeatPreference(preference)) {
    return { ok: false, error: "INVALID_PREFERENCE" };
  }
  const seat = pickSeatForPreference(seatPoolFor(booking), preference);
  if (!seat) return { ok: false, error: "NO_SEAT_AVAILABLE" };
  booking.seat = seat;
  addLogEntry(booking, {
    kind: "seat",
    text: `Seat ${seat} assigned — ${preference}.`,
    author: "Aeronova",
  });
  return { ok: true, seat, preference };
};

export type NoticeResult =
  | { ok: true; notice: PassengerNotice }
  | {
      ok: false;
      error: "INVALID_PARTY" | "INVALID_TEMPLATE" | "NO_CONTACT_ON_FILE";
    };

/**
 * BEAT 5, step 3 — tell somebody downstream that the trip moved.
 *
 * The contact is copied off the BOOKING, never taken from the caller: a
 * client-supplied name is a name the model spelled, and this record is the app
 * claiming it told a specific person. A party the booking has no contact for is
 * REFUSED, so Aeronova never claims to have reached someone it cannot reach.
 *
 * The log entry carries a FORCED marker so the change is un-skimmable on a
 * projector; a model that phrases it plainly does not get to cost the beat its
 * only visible artifact.
 */
export const notifyParty = (
  booking: Booking,
  party: string,
  template: string,
): NoticeResult => {
  if (!isNotifyParty(party)) return { ok: false, error: "INVALID_PARTY" };
  if (!isNoticeTemplate(template)) {
    return { ok: false, error: "INVALID_TEMPLATE" };
  }
  const contact = booking.contacts.find((c) => c.party === party);
  if (!contact) return { ok: false, error: "NO_CONTACT_ON_FILE" };

  const notice: PassengerNotice = {
    id: nextId("nt"),
    party,
    template,
    sentTo: contact.name,
    channel: contact.channel,
    createdAt: new Date().toISOString(),
  };
  booking.notices = [notice, ...booking.notices];
  addLogEntry(booking, {
    kind: "notice",
    text: markNote(`${contact.name} was told: ${template}.`),
    author: "Aeronova",
  });
  return { ok: true, notice };
};

export type ExceptionResult =
  | { ok: true; exception: FareException }
  | { ok: false; error: "INVALID_CODE" | "MISSING_DOCUMENTATION" };

/**
 * BEAT 6, unlock step 1 — file a DRAFT fare exception against a booking.
 *
 * The code is stored EXACTLY as the passenger entered it, decoy included. A
 * record that quietly corrected them would report a procedure nobody
 * demonstrated, and the refusal they then watch stay in place is the
 * demonstration working, not failing.
 *
 * ⚠️ NOTHING HERE SAYS WHETHER THE EXCEPTION WILL LIFT ANYTHING. A `lifts` flag
 * on the record — or in the route's response — would hand over the whole
 * withheld catalogue one probe at a time. The only way to find out is to retry
 * the change, which is exactly the loop the passenger demonstrates.
 */
export const fileException = (
  booking: Booking,
  code: string,
  documentReference: string,
  rationale: string,
): ExceptionResult => {
  if (!isValidExceptionCode(code)) return { ok: false, error: "INVALID_CODE" };
  if (!documentReference.trim()) {
    return { ok: false, error: "MISSING_DOCUMENTATION" };
  }
  const exception: FareException = {
    id: nextId("fex"),
    bookingId: booking.id,
    code,
    status: "draft",
    documentReference: documentReference.trim(),
    rationale: rationale.trim(),
    createdAt: new Date().toISOString(),
  };
  db.exceptions.push(exception);
  addLogEntry(booking, {
    kind: "exception",
    text: `Fare exception filed (${code}), citing ${exception.documentReference}.`,
    author: "Aeronova",
  });
  return { ok: true, exception };
};

export type ApproveResult =
  | { ok: true; exception: FareException }
  | { ok: false; error: "NOT_FOUND" | "ALREADY_APPROVED" };

/**
 * BEAT 6, unlock step 2 — approve a draft and LINK it to its booking.
 *
 * Linking is not the same as lifting. `checkFareChange` still asks
 * `exceptionLifts(code, ground)`, so a decoy — or a justifying category the
 * booking's record does not support — is linked, visible on the trip, and
 * releases nothing.
 */
export const approveException = (exceptionId: string): ApproveResult => {
  const exception = findException(exceptionId);
  if (!exception) return { ok: false, error: "NOT_FOUND" };
  if (exception.status !== "draft") {
    return { ok: false, error: "ALREADY_APPROVED" };
  }
  exception.status = "approved";
  const booking = db.bookings.find((b) => b.id === exception.bookingId);
  if (booking) {
    booking.activeExceptionId = exception.id;
    addLogEntry(booking, {
      kind: "exception",
      text: `Fare exception ${exception.code} approved.`,
      author: "Aeronova",
    });
  }
  return { ok: true, exception };
};

/**
 * BEAT 3d — file the durable trip brief. Newest first, like the trip log.
 *
 * Nothing here references a thread, a run or a message: the record belongs to
 * the application, which is the entire claim the beat makes on stage.
 */
export const fileTripBrief = (
  brief: Omit<TripBrief, "id" | "createdAt">,
): TripBrief => {
  const filed: TripBrief = {
    ...brief,
    id: nextId("tb"),
    createdAt: new Date().toISOString(),
  };
  db.briefs.unshift(filed);
  const booking = brief.bookingRef
    ? db.bookings.find((b) => b.reference === brief.bookingRef)
    : undefined;
  if (booking) {
    addLogEntry(booking, {
      kind: "brief",
      text: `Trip brief filed from the ${brief.hotelName} confirmation.`,
      author: "Aeronova",
    });
  }
  return filed;
};
