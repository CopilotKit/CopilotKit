/**
 * BEAT 3d — the hotel reservations behind the attached document.
 *
 * WHY A HOTEL CONFIRMATION, and not the other obvious candidate. The beat's real
 * test is whether the artifact says something NEITHER source alone could say. A
 * corporate travel policy would mostly restate preferences beat 4's memory
 * already carries, so a brief built from it is one the agent could have written
 * from what it already knew. A hotel confirmation carries a **last check-in
 * time** and a **cancellation deadline** that exist nowhere in Aeronova's world
 * — and the flight's arrival time exists nowhere in the hotel's. The brief's
 * headline is the collision of the two, and it is unforgeable proof the file was
 * read.
 *
 * ⚠️ THE DOCUMENT MUST NOT MENTION THE FLIGHT. `hotel-confirmation-pdf.ts` draws
 * only what a hotel knows. The moment the PDF quotes an arrival time, the two
 * facts are in one place, the collision is derivable from the attachment alone,
 * and the beat stops proving anything. The server computes the collision at
 * brief time.
 *
 * ⚠️ EVERY ROW BELONGS TO THE PARTY THE DOCUMENT IS ADDRESSED TO. Commerce
 * appended one hard-coded style to EVERY vendor's price sheet and thereby
 * asserted a supplier relationship that does not exist. Here each entry is keyed
 * to ONE booking and re-checked against the live ledger — the traveler's name
 * and the destination city both have to still agree — and the entry is DROPPED
 * rather than misattributed when a reseed moves the flight. Losing the document
 * for one trip is recoverable; a false claim about it is not.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"`.
 */

import type { Booking, Flight, Traveler } from "./trip-types";

export interface HotelConfirmationEntry {
  /** The ONE booking this reservation belongs to. */
  bookingId: string;
  /** Who the room is held for. Re-checked against the ledger before use. */
  guestName: string;
  hotelName: string;
  address: string;
  /** Re-checked against the booking's live destination city before use. */
  city: string;
  confirmationNumber: string;
  /** ISO date, in the hotel's own calendar. */
  checkInDate: string;
  nights: number;
  /** The hotel's last accepted arrival, in the hotel's clock. e.g. "22:30". */
  lastCheckInLocal: string;
  /** Free cancellation up to this time on the check-in date. e.g. "18:00". */
  cancellationDeadlineLocal: string;
  nightlyRateUsd: number;
  prepaid: boolean;
}

/**
 * One entry per booking that has a room behind it. Two, deliberately: a single
 * entry makes "keyed by party" indistinguishable from "there is only one row",
 * and the re-check below would never be exercised against a second shape.
 */
export const HOTEL_CONFIRMATIONS: HotelConfirmationEntry[] = [
  {
    bookingId: "bkg-av1423",
    guestName: "Camila Rojas",
    hotelName: "Casa Miraflores",
    address: "Calle Berlín 424, Miraflores",
    city: "Lima",
    confirmationNumber: "CM-77Q4132",
    checkInDate: "2026-07-14",
    nights: 3,
    // The collision. AV1423 is 55 minutes late and lands 22:05 + delay = 23:00.
    lastCheckInLocal: "22:30",
    cancellationDeadlineLocal: "18:00",
    nightlyRateUsd: 148,
    prepaid: true,
  },
  {
    bookingId: "bkg-av2214",
    guestName: "Tomás Aguirre",
    hotelName: "Bayfront Suites",
    address: "1120 Brickell Bay Drive",
    city: "Miami",
    confirmationNumber: "BFS-2214-88",
    checkInDate: "2026-08-13",
    lastCheckInLocal: "23:59",
    nights: 2,
    cancellationDeadlineLocal: "16:00",
    nightlyRateUsd: 212,
    prepaid: false,
  },
];

export interface ResolvedHotelConfirmation {
  entry: HotelConfirmationEntry;
  booking: Booking;
  flight: Flight;
  traveler: Traveler;
}

/**
 * The reservation for a booking — or `undefined` when the ledger no longer
 * supports it.
 *
 * THREE ways this returns nothing, and all three are the same rule: the document
 * may only be produced when the app can still stand behind every claim on it.
 * No entry; the booking, flight or traveler has gone; or the entry's guest name
 * or city no longer agrees with the ledger. A reseed that moves AV1423 to
 * Bogotá must not produce a Lima hotel confirmation addressed to a Lima trip
 * that no longer exists.
 */
export function hotelConfirmationFor(input: {
  booking: Booking | undefined;
  flights: Flight[];
  travelers: Traveler[];
}): ResolvedHotelConfirmation | undefined {
  const { booking, flights, travelers } = input;
  if (!booking) return undefined;
  const entry = HOTEL_CONFIRMATIONS.find((e) => e.bookingId === booking.id);
  if (!entry) return undefined;

  const flight = flights.find((f) => f.id === booking.flightId);
  if (!flight) return undefined;
  const traveler = travelers.find((t) => t.id === booking.travelerId);
  if (!traveler) return undefined;

  if (traveler.name !== entry.guestName) return undefined;
  if (flight.destinationCity !== entry.city) return undefined;

  return { entry, booking, flight, traveler };
}

export interface EffectiveArrival {
  /**
   * Minutes past the scheduled day's midnight, UNWRAPPED — so a flight that
   * slips into the next day is `1485`, not `45`. Comparisons use this.
   */
  minutes: number;
  /** The same instant as `HH:MM`, wrapped, for printing. */
  clock: string;
  /** True when the delay pushed the arrival into the following day. */
  nextDay: boolean;
}

/**
 * When the passenger actually gets to the destination, in the ARRIVAL AIRPORT's
 * own clock, with today's delay applied.
 *
 * Read out of the ISO string rather than through `Date`, for the same reason
 * `localHourOf` is: `new Date(iso).getHours()` answers in whatever timezone the
 * process happens to run in, so the same flight would collide with the same
 * hotel on one machine and not on another. Returns `null` on anything
 * unparseable, and every caller treats that as UNKNOWN rather than as midnight.
 *
 * ⚠️ `minutes` IS DELIBERATELY NOT WRAPPED. Wrapping it is the bug this type
 * exists to prevent: an arrival of 23:15 pushed 90 minutes late becomes 00:45,
 * and `"00:45" > "22:30"` is FALSE — so the one flight that misses the hotel by
 * the widest margin would be the one reported as arriving in time.
 */
export function effectiveArrival(flight: Flight): EffectiveArrival | null {
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(
    flight.arrivalLocal.trim(),
  );
  if (!match) return null;
  const delay = Number.isFinite(flight.delayMinutes)
    ? Math.max(0, Math.trunc(flight.delayMinutes))
    : 0;
  const minutes = Number(match[1]) * 60 + Number(match[2]) + delay;
  const wrapped = minutes % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return { minutes, clock: `${hh}:${mm}`, nextDay: minutes >= 24 * 60 };
}

/** `HH:MM` as minutes past midnight, or `null` when it is not a clock time. */
export function clockMinutes(text: string): number | null {
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/**
 * Does the flight land after the hotel stops taking arrivals?
 *
 * TRI-STATE, per failure-modes § 1: `null` when either clock is unreadable,
 * never `false`. A `false` here would tell the model "checked, and fine" about a
 * comparison nobody was able to make — which it would then say out loud.
 */
export function arrivesAfterLastCheckIn(
  arrival: EffectiveArrival | null,
  lastCheckInLocal: string,
): boolean | null {
  if (!arrival) return null;
  const deadline = clockMinutes(lastCheckInLocal);
  if (deadline === null) return null;
  return arrival.minutes > deadline;
}
