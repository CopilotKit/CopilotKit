"use client";

/**
 * The check-in concierge's view of AIRLINE'S ONE LEDGER.
 *
 * ⚠️ THIS FILE REPLACED `data/use-data.ts`. That hook was a second, parallel
 * seed of Camila's AV1423 — a `useState` store the shell ran as `skin.useData`
 * and every page read through `useSkinData<AirlineData>()`. Two substrates
 * describing one flight is a demo that can contradict itself on stage
 * (`data/beat-map.md` § "Where the two substrates touch"), so the REST ledger is
 * now the SOLE runtime authority for AV1423 and this module is the adapter: it
 * projects `useAirlineLedger()` onto the shapes the concierge components were
 * already written against.
 *
 * WHAT COMES FROM THE LEDGER, and therefore can no longer drift:
 * the passenger, the flight (route, times, aircraft, gate, status), the delay
 * and the disruption derived from it, the seat map (from the flight's OWN
 * `availableSeats` plus the booking's current seat), and the rebooking options.
 *
 * WHAT IS STILL SEED, because the REST substrate models no counterpart:
 * the miles balance and benefit list, the redemption catalogue, and the checked
 * bags. These are DISTRACTOR surfaces — `data/beat-map.md` § "Beat 5" requires
 * `showLoyalty`, `showRedemptions` and `trackBaggage` to stay registered so that
 * "it picked the right three" means something — and none of them is a fact the
 * ledger publishes, so importing them from `data/seed.ts` duplicates nothing.
 * The member's NAME, id and TIER are overwritten from the ledger traveller even
 * on the loyalty card, so the one identity that appears in two places has one
 * source.
 *
 * WHAT IS LOCAL, and says so: the manual seat pick and the boarding pass. There
 * is no REST route for either — `POST /bookings/[id]/seat` takes a PREFERENCE
 * and the server chooses the seat (beat 5, step 2), and no route issues a
 * boarding pass at all. Both are ordinary client affordances on the check-in
 * page, not claims about the ledger, and the readables describe them as what is
 * on screen rather than as what is on file.
 */

import { useCallback, useMemo, useState } from "react";
import { useAirlineLedger } from "../ledger-context";
import { seedBaggage, seedLoyalty, seedRedemptions } from "../data/seed";
import type {
  BaggageItem,
  BoardingPass,
  DisruptionAlert,
  Flight as ConciergeFlight,
  LoyaltyStatus,
  Passenger,
  RebookingOption as ConciergeRebookingOption,
  RedemptionOption,
  Seat,
  SeatMap,
} from "../data/types";
import type { BookingDto, Flight } from "../data/trip-types";
import { durationLabel, localClock } from "./local-clock";

/**
 * The booking the check-in flow is about.
 *
 * Named rather than derived, and named for the same reason
 * `attach-hotel-confirmation.ts` names its booking: this is Camila's Lima trip,
 * the one record the in-memory store used to hold, and a reseed that renames it
 * should make the check-in page say so rather than silently check her in for
 * somebody else's flight.
 */
export const CHECKIN_BOOKING_ID = "bkg-av1423";

/** Where the seeded fleet's cabin ends. Matches `data/seed.ts`'s own map. */
const CABIN_ROWS = 20;
const CABIN_COLUMNS = ["A", "B", "C", "D", "E", "F"] as const;
/** Rows sold as premium, and the one exit row, on the seeded narrow-body. */
const PREMIUM_LAST_ROW = 4;
const EXIT_ROW = 12;

/** Minutes past midnight a delay pushes the departure to, as a "19:35" clock. */
function delayedClock(iso: string, delayMinutes: number): string | null {
  const clock = localClock(iso);
  if (!clock || !Number.isFinite(delayMinutes) || delayMinutes <= 0)
    return null;
  const [h, m] = clock.split(":").map(Number);
  if (h === undefined || m === undefined) return null;
  const total = (h * 60 + m + Math.round(delayMinutes)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

/** The concierge-shaped flight, projected off the ledger's. */
function toConciergeFlight(flight: Flight): ConciergeFlight {
  return {
    flight_number: flight.flightNumber,
    origin: flight.origin,
    origin_city: flight.originCity,
    destination: flight.destination,
    destination_city: flight.destinationCity,
    departure_time: flight.departureLocal,
    arrival_time: flight.arrivalLocal,
    aircraft: flight.aircraft,
    status: flight.status,
    gate: flight.gate,
  };
}

/**
 * The disruption the flight's OWN condition implies, or `null`.
 *
 * Derived, never stored. The in-memory seed carried a hand-written alert saying
 * "delayed roughly 55 minutes", which stayed at 55 whatever the ledger said —
 * so beat 5 could resolve a cancellation while the banner still described a
 * delay. Deriving it means the alert cannot outlive the condition it describes.
 */
export function disruptionFor(flight: Flight | null): DisruptionAlert | null {
  if (!flight) return null;
  if (flight.status === "cancelled") {
    return {
      flight_number: flight.flightNumber,
      type: "cancellation",
      severity: "critical",
      message:
        `${flight.flightNumber} to ${flight.destinationCity} has been ` +
        `cancelled. A replacement flight is owed at no cost — the rebooking ` +
        `search has the alternatives.`,
      new_departure_time: null,
      new_gate: null,
    };
  }
  if (flight.delayMinutes > 0) {
    return {
      flight_number: flight.flightNumber,
      type: "delay",
      severity: flight.delayMinutes >= 120 ? "critical" : "warning",
      message:
        `${flight.flightNumber} to ${flight.destinationCity} is running about ` +
        `${flight.delayMinutes} minutes late. Rebooking options are available ` +
        `if the new arrival time does not work.`,
      new_departure_time: delayedClock(
        flight.departureLocal,
        flight.delayMinutes,
      ),
      new_gate: flight.gate,
    };
  }
  if (flight.scheduleChangeMinutes > 0) {
    return {
      flight_number: flight.flightNumber,
      type: "gate_change",
      severity: "info",
      message:
        `${flight.flightNumber} has moved by ${flight.scheduleChangeMinutes} ` +
        `minutes since the ticket was issued.`,
      new_departure_time: localClock(flight.departureLocal),
      new_gate: flight.gate,
    };
  }
  return null;
}

/**
 * The seat map, built from the flight's OWN free-seat list.
 *
 * Anything the ledger does not list as free is drawn occupied, so the map cannot
 * offer a seat the reseat route would refuse. The passenger's current seat is
 * always drawn selected even though it is (correctly) not in the free list.
 */
export function seatMapFor(
  flight: Flight | null,
  bookedSeat: string | null,
): SeatMap {
  const free = new Set(flight?.availableSeats ?? []);
  const seats: Seat[] = [];
  for (let row = 1; row <= CABIN_ROWS; row += 1) {
    for (const column of CABIN_COLUMNS) {
      const id = `${row}${column}`;
      let status: Seat["status"];
      if (bookedSeat && id === bookedSeat) status = "selected";
      else if (!free.has(id)) status = "occupied";
      else if (row <= PREMIUM_LAST_ROW) status = "premium";
      else if (row === EXIT_ROW) status = "exit";
      else status = "available";
      seats.push({ id, row, column, status });
    }
  }
  return {
    flight_number: flight?.flightNumber ?? "",
    rows: CABIN_ROWS,
    seats,
    selected_seat_id: bookedSeat,
  };
}

/**
 * What the pages and `AirlineTools` read.
 *
 * `ready` and the nullable fields are the deliberate difference from the old
 * `AirlineData`. That interface could not represent "the first read has not
 * landed yet", so every consumer of the in-memory store was structurally unable
 * to tell a loading screen from an empty one — which is the failure beat 3b
 * cannot survive, because an agent told "no flight" about a screen that is still
 * spinning describes it wrongly with total confidence.
 */
export interface ConciergeView {
  ready: boolean;
  bookingId: string;
  booking: BookingDto | null;
  passenger: Passenger | null;
  flight: ConciergeFlight | null;
  seatMap: SeatMap;
  boardingPass: BoardingPass | null;
  loyalty: LoyaltyStatus | null;
  redemptions: RedemptionOption[];
  disruption: DisruptionAlert | null;
  rebookingOptions: ConciergeRebookingOption[];
  baggage: BaggageItem[];
  /** Local-only: the passenger's pick on the seat map. See the file header. */
  selectSeat: (seatId: string) => void;
  /** Local-only: issues against whatever seat is selected, or null. */
  issueBoardingPass: () => BoardingPass | null;
  /** Presentational: the real rebooking write is `rebookOntoOption` in tools. */
  chooseRebooking: (optionId: string) => ConciergeRebookingOption | null;
}

export function useConciergeView(): ConciergeView {
  const { ready, travelers, bookings, flights, options } = useAirlineLedger();

  const booking =
    bookings.find((b) => b.id === CHECKIN_BOOKING_ID) ??
    /* A reseed that renames the record must not blank the page: fall back to the
       account holder's first ticketed booking rather than to nothing. */
    bookings.find((b) => b.status === "ticketed") ??
    null;
  const flight = flights.find((f) => f.id === booking?.flightId) ?? null;
  const traveler = travelers.find((t) => t.id === booking?.travelerId) ?? null;

  // Local seat pick, layered OVER the booking's seat. `null` means "the
  // passenger has not touched the map", which is not the same as "no seat".
  const [pickedSeat, setPickedSeat] = useState<string | null>(null);
  const [boardingPass, setBoardingPass] = useState<BoardingPass | null>(null);
  // Recorded so a chosen option reads as chosen; nothing renders it yet, which
  // is why only the setter is bound.
  const [, setChosenRebookingId] = useState<string | null>(null);

  const selectedSeat = pickedSeat ?? booking?.seat ?? null;

  const passenger = useMemo<Passenger | null>(
    () =>
      traveler && booking
        ? {
            name: traveler.name,
            pnr: booking.reference,
            tier: traveler.tier,
            member_id: traveler.memberId,
          }
        : null,
    [traveler, booking],
  );

  const conciergeFlight = useMemo<ConciergeFlight | null>(
    () => (flight ? toConciergeFlight(flight) : null),
    [flight],
  );

  const seatMap = useMemo(
    () => seatMapFor(flight, selectedSeat),
    [flight, selectedSeat],
  );

  const loyalty = useMemo<LoyaltyStatus | null>(
    () =>
      traveler
        ? {
            ...seedLoyalty,
            // The identity comes from the ledger even here, so the tier on the
            // loyalty card and the tier on the passenger header have ONE source.
            member_name: traveler.name,
            member_id: traveler.memberId,
            tier: traveler.tier,
          }
        : null,
    [traveler],
  );

  const disruption = useMemo(() => disruptionFor(flight), [flight]);

  const rebookingOptions = useMemo<ConciergeRebookingOption[]>(
    () =>
      options
        .filter((o) => o.bookingId === booking?.id)
        .map((o) => ({
          id: o.id,
          flight_number: o.flightNumber,
          departure_time: o.departureLocal,
          arrival_time: o.arrivalLocal,
          duration: durationLabel(o.durationMinutes),
          stops: o.stops,
          price_difference: o.fareDifferenceUsd,
          seats_available: o.seatsAvailable,
        })),
    [options, booking?.id],
  );

  const selectSeat = useCallback(
    (seatId: string) => {
      const seat = seatMap.seats.find((s) => s.id === seatId);
      // Refuse rather than record: a seat the flight has not got free is not a
      // seat, and quietly accepting one puts a number on a boarding pass that
      // no gate agent could honour.
      if (!seat || seat.status === "occupied" || seat.status === "blocked") {
        return;
      }
      setPickedSeat(seatId);
      setBoardingPass(null);
    },
    [seatMap],
  );

  const issueBoardingPass = useCallback((): BoardingPass | null => {
    if (!selectedSeat || !passenger || !conciergeFlight) return null;
    const pass: BoardingPass = {
      passenger_name: passenger.name,
      flight_number: conciergeFlight.flight_number,
      origin: conciergeFlight.origin,
      destination: conciergeFlight.destination,
      seat: selectedSeat,
      gate: conciergeFlight.gate ?? "TBD",
      // Off the ledger's own departure, never a hardcoded "18:05" — the old
      // in-memory store carried one and it outlived two reseeds.
      boarding_time: localClock(conciergeFlight.departure_time),
      sequence: 42,
      pnr: passenger.pnr,
      barcode_data: `${passenger.pnr}-${conciergeFlight.flight_number}-${selectedSeat}`,
    };
    setBoardingPass(pass);
    return pass;
  }, [selectedSeat, passenger, conciergeFlight]);

  const chooseRebooking = useCallback(
    (optionId: string): ConciergeRebookingOption | null => {
      const option = rebookingOptions.find((o) => o.id === optionId) ?? null;
      if (option) setChosenRebookingId(optionId);
      return option;
    },
    [rebookingOptions],
  );

  return useMemo(
    () => ({
      ready,
      bookingId: booking?.id ?? CHECKIN_BOOKING_ID,
      booking,
      passenger,
      flight: conciergeFlight,
      seatMap,
      boardingPass,
      loyalty,
      redemptions: seedRedemptions,
      disruption,
      rebookingOptions,
      baggage: seedBaggage,
      selectSeat,
      issueBoardingPass,
      chooseRebooking,
    }),
    [
      ready,
      booking,
      passenger,
      conciergeFlight,
      seatMap,
      boardingPass,
      loyalty,
      disruption,
      rebookingOptions,
      selectSeat,
      issueBoardingPass,
      chooseRebooking,
    ],
  );
}
