/**
 * Aeronova's REST substrate — the traveler profile, its bookings, and the
 * records the demo beats write.
 *
 * These are the shapes the ledger actually serves. `types.ts` next door holds the
 * older concierge-view shapes (`Passenger`, `Flight`, `SeatMap`, …), which are
 * now DERIVED from these by `../components/concierge-view.ts` rather than stored
 * — `Tier` is the one type still imported from there. Keep them in separate
 * files: the derivation direction is what stops a second seed of Camila's AV1423
 * reappearing.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"`.
 */

import type { Tier } from "./types";

export type Cabin = "economy" | "premium" | "business";

/**
 * The fare family a ticket or an option is priced in. `basic` is Basic Economy
 * — the fare beat 6's gate refuses, and the one beat 4's preference tells the
 * agent to avoid even when it is cheaper.
 */
export type FareBrand = "basic" | "main" | "flex" | "promo";

export type FlightStatus =
  | "on_time"
  | "delayed"
  | "boarding"
  | "cancelled"
  | "departed";

export interface Traveler {
  id: string;
  name: string;
  memberId: string;
  tier: Tier;
  /**
   * BEAT 4 — the passenger's own clock. Every ISO timestamp in this substrate
   * carries its airport's offset, so a tool obeying "quote departures in my
   * home time" has both halves of what it needs without inventing a timezone.
   */
  homeTimezone: string;
  /** True for the account holder; the other two are saved travel companions. */
  accountHolder: boolean;
  /** How this traveler relates to the account holder, for the trips page. */
  relationship: string;
}

export interface TravelProfile {
  accountName: string;
  memberSince: string;
  /**
   * A BRAND AND DOTS, never digits. Beat 3a's secret is the last four of this
   * card and it must not exist anywhere the ledger can be read from — see
   * `card-authorization.ts`.
   */
  paymentCardLabel: string;
}

export interface Flight {
  id: string;
  flightNumber: string;
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  /** ISO 8601 WITH the airport's UTC offset. Never a bare local string. */
  departureLocal: string;
  arrivalLocal: string;
  aircraft: string;
  gate: string | null;
  status: FlightStatus;
  /** Minutes late today. `0` when the flight is running to schedule. */
  delayMinutes: number;
  /**
   * How far the SCHEDULE moved since the ticket was issued, in minutes. `0`
   * means the schedule is the one the passenger bought. At or past
   * `INVOLUNTARY_SCHEDULE_CHANGE_MINUTES` this permits a free change on any
   * fare — see `fare-rules.ts`.
   */
  scheduleChangeMinutes: number;
  /**
   * Seats currently free on this flight, as seat ids ("14C"). The reseat write
   * picks from this list; a preference with nothing free is REFUSED rather than
   * satisfied with an invented seat.
   */
  availableSeats: string[];
}

/**
 * What a ticket permits. This is Aeronova's authority model: the gate beat 6
 * teaches around is a property of the FARE, not of any person's rank.
 */
export interface FareRules {
  brand: FareBrand;
  /** Display name as it appears on the ticket, e.g. "Basic Economy". */
  brandLabel: string;
  cabin: Cabin;
  /** Whether a VOLUNTARY change is permitted at all. */
  changeable: boolean;
  /** Charged on a permitted voluntary change, on top of any fare difference. */
  changeFeeUsd: number;
  refundable: boolean;
}

/**
 * The circumstance a booking's record actually DOCUMENTS.
 *
 * ⚠️ SERVER-SIDE ONLY. `store.snapshot()` strips this field, because a
 * code-shaped token on the wire is a sixth leak channel for beat 6's withheld
 * vocabulary (`fare-waiver-codes.ts` maps categories onto these grounds). The
 * passenger reads the same fact as PROSE, in `Booking.fareNotes`.
 */
export type WaiverGround =
  | "schedule_change"
  | "medical"
  | "bereavement"
  | "military";

export interface TripLogEntry {
  id: string;
  /** What happened, in the passenger's language. */
  text: string;
  kind: "change" | "seat" | "notice" | "exception" | "brief";
  author: string;
  createdAt: string;
}

export interface PassengerNotice {
  id: string;
  party: string;
  template: string;
  /** Copied off the BOOKING's contact list, never taken from the caller. */
  sentTo: string;
  channel: string;
  createdAt: string;
}

/** Somebody downstream of the trip who is told when it moves (beat 5, step 3). */
export interface TripContact {
  party: string;
  name: string;
  channel: string;
  handle: string;
}

export interface Booking {
  id: string;
  /** The PNR the passenger reads out, e.g. "AV7QK2". */
  reference: string;
  travelerId: string;
  flightId: string;
  fare: FareRules;
  farePaidUsd: number;
  seat: string | null;
  status: "ticketed" | "changed" | "flown";
  /** What this booking was reissued onto, once it has been. */
  reissued: Reissue | null;
  /**
   * BEAT 6 — the APPROVED exception currently linked to this booking, if any.
   * Linked is not the same as lifting: see `exceptionLifts`.
   */
  activeExceptionId: string | null;
  /**
   * Human prose the passenger reads on their own booking. NEVER a code-shaped
   * token: this is what the ledger publishes in place of `waiverGround`, and
   * the passenger picking a category in the exception form is reading THESE
   * sentences. Keep them readable and keep them free of catalogue vocabulary.
   */
  fareNotes: string[];
  /** ⚠️ SERVER-SIDE ONLY — stripped by `store.snapshot()`. See `WaiverGround`. */
  waiverGround: WaiverGround | null;
  contacts: TripContact[];
  log: TripLogEntry[];
  notices: PassengerNotice[];
}

/** A booking as the LEDGER publishes it — `waiverGround` removed. */
export type BookingDto = Omit<Booking, "waiverGround">;

/**
 * BEAT 3c — one row of the rebooking search. A row is a (flight, cabin) pair,
 * which is how flight search actually works: the same departure is offered at
 * several prices in several fare families, and the passenger filters across all
 * of them.
 */
export interface RebookingOption {
  id: string;
  bookingId: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
  stops: number;
  cabin: Cabin;
  fareBrand: FareBrand;
  /** What the passenger pays to move onto this option, before any change fee. */
  fareDifferenceUsd: number;
  seatsAvailable: number;
  operatedBy: string;
  /**
   * Seat ids free on this option, so a reissued booking still has somewhere to
   * reseat (beat 5, step 2). Carried on the OPTION rather than looked up from a
   * `Flight` because an option is a (flight, cabin) pair and free seats are a
   * property of the cabin, not of the aircraft.
   */
  availableSeats: string[];
}

/**
 * What a booking was reissued ONTO. Written by `POST /bookings/[id]/change`.
 *
 * The booking keeps its original `flightId` — that is what it was ticketed on,
 * and it is historically true — so `checkFareChange` keeps reading the flight
 * whose conditions the ticket was sold under. A reissued booking is `status:
 * "changed"` and the change route refuses to move it again, which is what stops
 * a presenter demonstrating twice on one record.
 */
export interface Reissue {
  optionId: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
  cabin: Cabin;
  /** Recomputed server-side. A client-supplied figure is always ignored. */
  amountPaidUsd: number;
  /** The grounds the change was permitted on — `involuntary`, and so on. */
  permission: string;
  reissuedAt: string;
}

/** BEAT 6 — a fare exception, as filed. Recorded whether or not it lifts. */
export interface FareException {
  id: string;
  bookingId: string;
  /**
   * EXACTLY as the passenger entered it, decoy included. A record that quietly
   * corrected them would report a procedure nobody demonstrated.
   */
  code: string;
  status: "draft" | "approved";
  /** The documentation the passenger supplied. Required, non-empty. */
  documentReference: string;
  rationale: string;
  createdAt: string;
}

/**
 * BEAT 3d — the durable artifact. Belongs to the APPLICATION, not the thread:
 * delete the whole conversation and this is still on the trip record.
 *
 * The field split is the load-bearing part. See `data/beat-map.md` § "Beat 3d".
 */
export interface TripBrief {
  id: string;
  createdAt: string;

  // ---- Owned by the DOCUMENT (model-authored; the beat's proof) ----------
  hotelName: string;
  confirmationNumber: string;
  address: string;
  /** e.g. "22:30" — the hotel's last accepted arrival, in the hotel's clock. */
  lastCheckInLocal: string;
  cancellationDeadlineLocal: string;
  nightlyRateUsd: number;

  // ---- Owned by the LEDGER (settled server-side; never `??`) -------------
  /**
   * `null` when the document could not be matched to a booking. Absence is the
   * answer, not a reason to keep whatever the model read.
   */
  bookingRef: string | null;
  travelerName: string | null;
  arrivalStation: string | null;
  arrivalLocal: string | null;

  // ---- Derived from BOTH -------------------------------------------------
  /**
   * The collision that is the whole point of the beat. TRI-STATE: `null` when
   * arrival is unknown, never `false` — a `false` here would tell the model
   * "checked, fine" about something nobody checked.
   */
  arrivesAfterLastCheckIn: boolean | null;
  /** One sentence, derived. What the agent reads out. */
  headline: string;
}
