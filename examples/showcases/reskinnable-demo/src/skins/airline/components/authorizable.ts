"use client";

/**
 * BEAT 3a — which options the card confirmation may be OFFERED on, decided on
 * the client from the ledger the passenger is already looking at.
 *
 * ⚠️ THIS IS A DISPLAY FILTER, NEVER THE GATE. `POST /authorizations` re-runs
 * `checkFareChange()` server-side on figures it recomputes itself, and that is
 * the only thing that decides anything. Everything here exists so the card does
 * not RENDER a box that cannot succeed (failure-modes § 12: never offer a second
 * factor on something the entitlement refuses, and never on a $0 move). If this
 * file and the server ever disagree, the server wins and the card prints its
 * refusal verbatim — which is exactly what `card-confirmation-card.tsx` does.
 *
 * WHY IT CANNOT SIMPLY CALL `data/fare-rules.ts`. `checkFareChange` needs
 * `Booking.waiverGround`, and `store.snapshot()` strips that field on purpose —
 * a code-shaped token on the wire is a sixth leak channel for beat 6's withheld
 * vocabulary. So the client can see THAT a booking carries an approved
 * exception, and never WHICH circumstance grounds it. The consequence is stated
 * rather than papered over: for a booking whose linked exception is a decoy (or
 * a justifying category the record does not support) this helper is OPTIMISTIC —
 * it offers the card, the server refuses with `FARE_NOT_CHANGEABLE`, and the
 * room watches a perfectly successful filing change nothing at all. That is beat
 * 6's whole demonstration, so the optimism is the right direction to be wrong in.
 * The pessimistic alternative — assuming no exception ever lifts — would hide
 * the card after a genuine unlock and break the replay.
 *
 * The threshold is imported rather than restated, so the client and the server
 * cannot form two opinions about what "involuntary" means.
 */

import { INVOLUNTARY_SCHEDULE_CHANGE_MINUTES } from "../data/fare-rules";
import type {
  BookingDto,
  FareException,
  Flight,
  RebookingOption,
} from "../data/trip-types";

export type ClientPermission = "involuntary" | "fare_permits" | "exception";

/**
 * The grounds a change would be permitted on, or `null` for "the fare refuses".
 * Same ORDER as `checkFareChange`: involuntary disruption short-circuits before
 * the fare is consulted at all, which is what keeps beat 5 clear of beat 6.
 */
export function permissionFor(
  booking: BookingDto,
  flight: Flight,
  exceptions: FareException[],
): ClientPermission | null {
  if (
    flight.status === "cancelled" ||
    flight.scheduleChangeMinutes >= INVOLUNTARY_SCHEDULE_CHANGE_MINUTES
  ) {
    return "involuntary";
  }
  if (booking.fare.changeable) return "fare_permits";
  const linked = booking.activeExceptionId
    ? exceptions.find((e) => e.id === booking.activeExceptionId)
    : undefined;
  // Linked and approved is as much as the wire can tell us — see the header.
  if (linked && linked.status === "approved") return "exception";
  return null;
}

/**
 * What the passenger would owe. Mirrors `amountDueUsd` in `data/fare-rules.ts`
 * clause for clause, and is reimplemented rather than imported only because that
 * one is typed against the server-side `Booking` (with `waiverGround`).
 */
export function amountDueFor(
  booking: BookingDto,
  option: RebookingOption,
  permission: ClientPermission,
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

export interface OfferableOption {
  option: RebookingOption;
  amountDueUsd: number;
}

/**
 * Every option the card may legitimately be offered on, cheapest first.
 *
 * TWO filters, both from failure-modes § 12: the change has to be PERMITTED
 * already, and money has to actually be DUE. An involuntary rebooking after a
 * cancellation costs $0, and asking for a card to move $0 is a formality dressed
 * up as an authorization — the route agrees and answers `422 NOTHING_DUE`.
 */
export function offerableOptions(input: {
  booking: BookingDto;
  flight: Flight;
  options: RebookingOption[];
  exceptions: FareException[];
}): OfferableOption[] {
  const { booking, flight, options, exceptions } = input;
  if (booking.status !== "ticketed") return [];
  const permission = permissionFor(booking, flight, exceptions);
  if (!permission) return [];
  return options
    .filter((option) => option.bookingId === booking.id)
    .map((option) => ({
      option,
      amountDueUsd: amountDueFor(booking, option, permission),
    }))
    .filter((entry) => entry.amountDueUsd > 0)
    .sort((a, b) => a.amountDueUsd - b.amountDueUsd);
}
