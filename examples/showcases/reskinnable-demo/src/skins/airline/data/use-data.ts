"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  AirlineData,
  BoardingPass,
  RebookingOption,
  SeatMap,
} from "./types";
import {
  seedBaggage,
  seedDisruption,
  seedFlight,
  seedLoyalty,
  seedPassenger,
  seedRebookingOptions,
  seedRedemptions,
  seedSeatMap,
} from "./seed";

/**
 * The airline skin's seed-backed in-memory store. This is `skin.useData` —
 * the shell runs it once per skin mount inside `SkinProvider`, and the skin's
 * own components read it via `useSkinData<AirlineData>()` or by calling this
 * hook directly. Mutating actions (`selectSeat`, `issueBoardingPass`,
 * `chooseRebooking`) update local React state so the UI reflects passenger
 * choices without a backend round-trip.
 */
export function useAirlineData(): AirlineData {
  const passenger = seedPassenger;
  const flight = seedFlight;
  const loyalty = seedLoyalty;
  const redemptions = seedRedemptions;
  const disruption = seedDisruption;
  const rebookingOptions = seedRebookingOptions;
  const baggage = seedBaggage;

  const [seatMap, setSeatMap] = useState<SeatMap>(seedSeatMap);
  const [boardingPass, setBoardingPass] = useState<BoardingPass | null>(null);
  const [chosenRebookingId, setChosenRebookingId] = useState<string | null>(
    null,
  );

  const selectSeat = useCallback((seatId: string) => {
    setSeatMap((prev) => {
      const target = prev.seats.find((s) => s.id === seatId);
      if (!target) return prev;
      if (target.status === "occupied" || target.status === "blocked") {
        return prev;
      }
      const seats = prev.seats.map((s) => {
        // Restore the previously selected seat to its underlying kind.
        if (s.id === prev.selected_seat_id && s.id !== seatId) {
          const restored =
            s.row <= 4 ? "premium" : s.row === 12 ? "exit" : "available";
          return { ...s, status: restored as typeof s.status };
        }
        if (s.id === seatId) return { ...s, status: "selected" as const };
        return s;
      });
      return { ...prev, seats, selected_seat_id: seatId };
    });
    setBoardingPass(null);
  }, []);

  const issueBoardingPass = useCallback((): BoardingPass | null => {
    let issued: BoardingPass | null = null;
    setSeatMap((prev) => {
      if (!prev.selected_seat_id) return prev;
      issued = {
        passenger_name: passenger.name,
        flight_number: flight.flight_number,
        origin: flight.origin,
        destination: flight.destination,
        seat: prev.selected_seat_id,
        gate: flight.gate ?? "TBD",
        boarding_time: "18:05",
        sequence: 42,
        pnr: passenger.pnr,
        barcode_data: `${passenger.pnr}-${flight.flight_number}-${prev.selected_seat_id}`,
      };
      return prev;
    });
    setBoardingPass(issued);
    return issued;
  }, [
    passenger.name,
    passenger.pnr,
    flight.flight_number,
    flight.origin,
    flight.destination,
    flight.gate,
  ]);

  const chooseRebooking = useCallback(
    (optionId: string): RebookingOption | null => {
      const option = rebookingOptions.find((o) => o.id === optionId) ?? null;
      if (option) setChosenRebookingId(optionId);
      return option;
    },
    [rebookingOptions],
  );

  return useMemo(
    () => ({
      passenger,
      flight,
      seatMap,
      boardingPass,
      loyalty,
      redemptions,
      disruption,
      rebookingOptions,
      baggage,
      selectSeat,
      issueBoardingPass,
      chooseRebooking,
      // exposed for callers that want the current rebooking choice
      chosenRebookingId,
    }),
    [
      passenger,
      flight,
      seatMap,
      boardingPass,
      loyalty,
      redemptions,
      disruption,
      rebookingOptions,
      baggage,
      selectSeat,
      issueBoardingPass,
      chooseRebooking,
      chosenRebookingId,
    ],
  ) as AirlineData;
}
