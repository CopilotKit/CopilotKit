"use client";

/**
 * One traveller's trips, as they appear on Camila's account.
 *
 * ⚠️ THE FRAMING IS LOAD-BEARING — see `data/beat-map.md` § "Where the passenger
 * framing genuinely fights the beats", point 3. Aeronova is ONE traveller's
 * account (Camila Rojas) with two saved companions on it, and an earlier attempt
 * to reframe this skin as an irregular-operations control desk was REJECTED. A
 * flat table of three people's bookings is how that reframe creeps back in: it
 * reads as a queue of other people's problems, which is precisely an ops desk.
 *
 * So this component renders ONE traveller's trips and is always given a
 * `label` that says whose they are and why they are on this account ("Your
 * trips", "Trips booked for Tomás Aguirre"). The page stacks the account
 * holder's own list first and nests the companions' under their own named
 * cards. Nothing here ever renders a traveller COLUMN, because a traveller
 * column is what turns saved travellers back into a customer list.
 *
 * `buildAccountTrips` is exported and is the ONE derivation both the panel and
 * beat 3b's readable read. Deriving the readable's rows separately is the
 * commerce bug (a readable slicing 5 against a panel painting 6), and it fails
 * silently — the agent answers fluently and wrongly.
 */

import { cn } from "@/lib/utils";
import type { BookingDto, Flight, Traveler } from "../data/trip-types";
import { localClock, localDate } from "./local-clock";

export type TripTone = "ok" | "warn" | "bad";

/** One booking, flattened for display. Never carries the traveller's name. */
export interface AccountTrip {
  bookingId: string;
  /** The PNR the passenger reads out. */
  reference: string;
  flightNumber: string;
  origin: string;
  destination: string;
  /** "Santiago → Lima". */
  route: string;
  departsLocal: string;
  /** "14 Jul 18:40", in the departure airport's own clock. */
  departsLabel: string;
  /** "Delayed 55m", "Cancelled", "On time". */
  statusLabel: string;
  tone: TripTone;
  /** "Basic Economy", "Flex" — the ticket's own fare family. */
  fareLabel: string;
  /** Whether the FARE permits a voluntary change. Aeronova's authority model. */
  changeable: boolean;
  seat: string | null;
  /** Human prose off the booking. Never a code-shaped token — see `fareNotes`. */
  notes: string[];
}

const MINUTES_LABEL = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};

function statusOf(flight: Flight): { statusLabel: string; tone: TripTone } {
  if (flight.status === "cancelled") {
    return { statusLabel: "Cancelled", tone: "bad" };
  }
  if (flight.status === "delayed") {
    return {
      statusLabel: flight.delayMinutes
        ? `Delayed ${MINUTES_LABEL(flight.delayMinutes)}`
        : "Delayed",
      tone: "warn",
    };
  }
  // A schedule change is not today's operational status — it is a change to the
  // itinerary the ticket was SOLD on, and it is the grievance beat 6's first
  // gated booking turns on. It only surfaces when nothing worse is happening.
  if (flight.scheduleChangeMinutes > 0) {
    return {
      statusLabel: `Schedule changed ${MINUTES_LABEL(flight.scheduleChangeMinutes)}`,
      tone: "warn",
    };
  }
  if (flight.status === "boarding")
    return { statusLabel: "Boarding", tone: "ok" };
  if (flight.status === "departed")
    return { statusLabel: "Departed", tone: "ok" };
  return { statusLabel: "On time", tone: "ok" };
}

/**
 * Every booking held for `traveler`, newest departure LAST — a passenger reads
 * their trips in the order they will take them, not newest-first like an
 * operations log. A booking whose flight is missing from the ledger is DROPPED
 * rather than rendered with blanks: a row that cannot say where it is going is
 * not a trip, and beat 3b would have the agent describe it as one.
 */
export function buildAccountTrips(
  bookings: BookingDto[],
  flights: Flight[],
  traveler: Traveler,
): AccountTrip[] {
  const byId = new Map(flights.map((f) => [f.id, f]));
  return bookings
    .filter((b) => b.travelerId === traveler.id)
    .flatMap((booking) => {
      const flight = byId.get(booking.flightId);
      if (!flight) return [];
      const { statusLabel, tone } = statusOf(flight);
      return [
        {
          bookingId: booking.id,
          reference: booking.reference,
          flightNumber: flight.flightNumber,
          origin: flight.origin,
          destination: flight.destination,
          route: `${flight.originCity} → ${flight.destinationCity}`,
          departsLocal: flight.departureLocal,
          departsLabel:
            `${localDate(flight.departureLocal)} ${localClock(flight.departureLocal)}`.trim(),
          statusLabel,
          tone,
          fareLabel: booking.fare.brandLabel,
          changeable: booking.fare.changeable,
          seat: booking.seat,
          notes: booking.fareNotes,
        } satisfies AccountTrip,
      ];
    })
    .sort((a, b) => a.departsLocal.localeCompare(b.departsLocal));
}

const TONE_CLASS: Record<TripTone, string> = {
  ok: "bg-surface-muted text-ink-muted",
  warn: "bg-amber-100 text-amber-700",
  bad: "bg-negative-soft text-negative",
};

export function TripList({
  label,
  trips,
  empty = "No trips on this account yet.",
}: {
  /** Whose trips these are. Doubles as the list's accessible name. */
  label: string;
  trips: AccountTrip[];
  empty?: string;
}) {
  if (trips.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-hairline p-6 text-center text-sm text-ink-muted">
        {empty}
      </div>
    );
  }
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {trips.map((trip) => (
        <li
          key={trip.bookingId}
          className="rounded-2xl border border-hairline bg-surface p-4 shadow-soft"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-sm font-semibold text-ink">
              {trip.flightNumber}
            </span>
            <span className="text-sm font-medium text-ink">{trip.route}</span>
            <span className="text-xs text-ink-muted">
              {trip.departsLabel || "—"}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                TONE_CLASS[trip.tone],
              )}
            >
              {trip.statusLabel}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            <span>
              Confirmation{" "}
              <span className="font-mono text-ink">{trip.reference}</span>
            </span>
            <span>
              {trip.fareLabel}
              {trip.changeable ? "" : " · no changes permitted"}
            </span>
            <span>Seat {trip.seat ?? "not assigned"}</span>
          </div>

          {trip.notes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-t border-hairline pt-2 text-xs leading-snug text-ink-muted">
              {trip.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
