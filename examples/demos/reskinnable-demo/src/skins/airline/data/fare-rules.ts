/**
 * BEAT 6's gate — Aeronova's authority model, which is ENTITLEMENT rather than
 * hierarchy.
 *
 * A passenger has no approval limit and no manager to escalate to, so this skin
 * gates on the thing a passenger genuinely runs into: **what their fare
 * permits.** "This ticket cannot be reissued" refuses exactly as hard as "you
 * lack approval authority" and needs no organizational role at all. That is what
 * lets Aeronova stay a passenger-facing concierge and still hit beats 3a and 6.
 *
 * THE GATE IS ON THE FARE, NOT ON AN AMOUNT. That distinction is load-bearing
 * and it is why this module splits permission (`checkFareChange`) from money
 * (`amountDueUsd`). Logistics gates on cost, so WHICH option the caller names
 * decides whether its gate fires — which is why failure-modes § 12 tells that
 * skin never to let the agent pick the option. Here the refusal is a property of
 * the ticket, so no choice of option can slip past it: every option on a
 * non-changeable booking is refused. `authorizations/route.test.ts` walks all of
 * them and asserts exactly that.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"`.
 */

import { exceptionLifts } from "./fare-waiver-codes";
import type {
  Booking,
  FareException,
  Flight,
  RebookingOption,
} from "./trip-types";

/**
 * How far a schedule has to move before the change becomes INVOLUNTARY and the
 * fare's own conditions stop applying. Four hours is the threshold most carriers
 * publish, and it is chosen here for a second reason: beat 6's first gated
 * booking sits at 3h 10m, deliberately BELOW it. A schedule change the automatic
 * rule does not cover is precisely when a human files an exception, which is the
 * grievance the demonstration is about.
 */
export const INVOLUNTARY_SCHEDULE_CHANGE_MINUTES = 240;

export type ChangePermission =
  /** The airline broke the itinerary. Free, on any fare, by rule. */
  | "involuntary"
  /** The ticket's own conditions allow a voluntary change. */
  | "fare_permits"
  /** A justifying, GROUNDED exception is approved and linked to the booking. */
  | "exception";

export type FareChangeCheck =
  | { allowed: true; permission: ChangePermission }
  | { allowed: false; code: "FARE_NOT_CHANGEABLE"; message: string };

/**
 * Whether this booking may be reissued at all, and on what grounds.
 *
 * Order matters. Involuntary disruption is checked FIRST, before the fare is
 * consulted at all — which is what keeps beat 5 clear of beat 6. Beat 5's
 * booking is on a cancelled flight, so it is free to rebook whatever its fare
 * says; beat 6's gated bookings are voluntary changes on intact flights.
 * `fare-rules.test.ts` pins both directions.
 *
 * The refusal names the FARE CONDITION and nothing else. Not the word
 * "exception", not a category, not "ask an agent" — the way through is the thing
 * the passenger demonstrates and the agent has to learn.
 */
export function checkFareChange(input: {
  booking: Booking;
  flight: Flight;
  exceptions: FareException[];
}): FareChangeCheck {
  const { booking, flight, exceptions } = input;

  if (
    flight.status === "cancelled" ||
    flight.scheduleChangeMinutes >= INVOLUNTARY_SCHEDULE_CHANGE_MINUTES
  ) {
    return { allowed: true, permission: "involuntary" };
  }

  if (booking.fare.changeable) {
    return { allowed: true, permission: "fare_permits" };
  }

  const linked = booking.activeExceptionId
    ? exceptions.find((e) => e.id === booking.activeExceptionId)
    : undefined;
  if (
    linked &&
    linked.status === "approved" &&
    exceptionLifts(linked.code, booking.waiverGround)
  ) {
    return { allowed: true, permission: "exception" };
  }

  const nonRefundable = booking.fare.refundable
    ? ""
    : ", a non-refundable fare";
  return {
    allowed: false,
    code: "FARE_NOT_CHANGEABLE",
    message:
      `${booking.reference} is ticketed in ${booking.fare.brandLabel}${nonRefundable}. ` +
      `Changes are not permitted on this fare — this ticket cannot be reissued ` +
      `to another flight.`,
  };
}

/**
 * What the passenger actually owes to move onto `option`, given the grounds the
 * change was permitted on.
 *
 * - `involuntary` — nothing. Aeronova broke the itinerary; it pays for the move.
 * - `fare_permits` — the ticket's change fee plus the fare difference.
 * - `exception` — the fare difference only. Lifting the fare's condition lifts
 *   its change fee with it; the passenger still pays for the more expensive
 *   seat, because that money is the airline's cost, not its penalty.
 *
 * Never trusts a client-supplied figure. Every caller recomputes through here,
 * or the gate is theater.
 */
export function amountDueUsd(
  booking: Booking,
  option: RebookingOption,
  permission: ChangePermission,
): number {
  const difference = Math.max(0, option.fareDifferenceUsd);
  switch (permission) {
    case "involuntary":
      return 0;
    case "fare_permits":
      return booking.fare.changeFeeUsd + difference;
    case "exception":
      return difference;
  }
}

export const formatUsd = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** One option the passenger may take AND has something to pay for. */
export interface AuthorizableOption {
  option: RebookingOption;
  amountDueUsd: number;
}

/**
 * BEAT 3a — every option the card confirmation may legitimately be offered on.
 *
 * TWO filters, and both are from failure-modes § 12:
 *
 *  - The change has to be PERMITTED already. A second factor confirms who is
 *    acting; it never releases something the fare refuses. Offering the card on
 *    a refused option is how a skin accidentally builds a door around beat 6.
 *  - Money has to actually be due. An involuntary rebooking after a cancellation
 *    costs `$0`, and asking for a card to move `$0` is a formality dressed up as
 *    an authorization — the same bug logistics' `$0` `absorb` option produced.
 *    An empty result means the card must say "nothing is due on this one",
 *    never render a box that cannot succeed.
 *
 * Sorted cheapest-first: it is the option a passenger actually reaches for.
 */
export function authorizableOptions(input: {
  booking: Booking;
  flight: Flight;
  options: RebookingOption[];
  exceptions: FareException[];
}): AuthorizableOption[] {
  const { booking, flight, options, exceptions } = input;
  const check = checkFareChange({ booking, flight, exceptions });
  if (!check.allowed) return [];
  return options
    .filter((option) => option.bookingId === booking.id)
    .map((option) => ({
      option,
      amountDueUsd: amountDueUsd(booking, option, check.permission),
    }))
    .filter((entry) => entry.amountDueUsd > 0)
    .sort((a, b) => a.amountDueUsd - b.amountDueUsd);
}

/** One booking the fare rules currently refuse to reissue. */
export interface BlockedBooking {
  booking: Booking;
  flight: Flight;
  /** The refusal the gate would actually produce, verbatim. */
  message: string;
}

/**
 * BEAT 6 — every booking the passenger-facing exception form may legitimately
 * offer.
 *
 * DERIVED, never stored: the verdict comes from `checkFareChange`, the same
 * function the server runs on every change request, so the form can never
 * advertise a booking the gate would not actually refuse — nor hide one it
 * would.
 *
 * Bookings already reissued are dropped: the demonstration that taught the
 * procedure moved one of these, and leaving it on the list afterwards invites
 * the presenter to demonstrate twice on the same case.
 */
export function blockedByFareRules(input: {
  bookings: Booking[];
  flights: Flight[];
  exceptions: FareException[];
}): BlockedBooking[] {
  const { bookings, flights, exceptions } = input;
  const blocked: BlockedBooking[] = [];
  for (const booking of bookings) {
    if (booking.status !== "ticketed") continue;
    const flight = flights.find((f) => f.id === booking.flightId);
    if (!flight) continue;
    const check = checkFareChange({ booking, flight, exceptions });
    if (!check.allowed) {
      blocked.push({ booking, flight, message: check.message });
    }
  }
  return blocked;
}
