"use client";

import { useMemo } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useConciergeView } from "../components/concierge-view";
import { FlightCard, SeatMap, BoardingPass } from "../components";
import { isSelectableSeat, orderedSeats } from "../components/seat-map";

export function TripsPage() {
  // The REST ledger, projected onto the check-in shapes. It used to be
  // `useSkinData<AirlineData>()` over a second in-memory seed of AV1423 — see
  // `../components/concierge-view.ts` for why that seed is gone.
  const data = useConciergeView();

  // The seats a passenger can actually pick, in the order the map paints them.
  // `orderedSeats` and `isSelectableSeat` are the SEAT MAP's own ordering and
  // its own button predicate — the readable below must not re-derive either, or
  // it drifts from the panel and the agent describes a screen nobody is looking
  // at (demo-beats.md § 3b, the commerce 5-against-6 bug).
  const openSeats = useMemo(
    () => orderedSeats(data.seatMap).filter(isSelectableSeat),
    [data.seatMap],
  );

  // ── BEAT 3b, part 2 — what is VISIBLY on this screen ─────────────────────
  // ONE MECHANICAL CONSTRAINT before rewording any of this: `readables.test.tsx`
  // anchors its omission guard on a `useAgentContext(` window terminated by the
  // statement's own semicolon, so a SEMICOLON in the description below ends that
  // window early and fails the guard for reasons the message will not explain.
  // Use dashes and full stops.
  useAgentContext({
    description:
      "What is on the Trip screen right now — the passenger's flight, the seat " +
      "map with the seats still selectable in the order they are drawn, and " +
      "the boarding pass if one has been issued. `boarding_pass` is null until " +
      "the passenger asks for one. `loading` is true while the first ledger " +
      "read is still in flight — say so rather than reporting an empty trip.",
    value: JSON.stringify({
      page: "Your trip",
      loading: !data.ready,
      flight: data.flight
        ? {
            number: data.flight.flight_number,
            origin: data.flight.origin,
            destination: data.flight.destination,
            departure: data.flight.departure_time,
            arrival: data.flight.arrival_time,
            status: data.flight.status,
            gate: data.flight.gate,
          }
        : null,
      seat_map: {
        flight: data.seatMap.flight_number,
        selected_seat: data.seatMap.selected_seat_id,
        open_seat_count: openSeats.length,
      },
      open_seats: openSeats.map((s) => s.id),
      boarding_pass: data.boardingPass
        ? {
            seat: data.boardingPass.seat,
            gate: data.boardingPass.gate,
            sequence: data.boardingPass.sequence,
            boarding_time: data.boardingPass.boarding_time,
          }
        : null,
    }),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Your trip</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Check in, choose a seat, and get your boarding pass.
        </p>
      </div>

      {data.flight ? (
        <FlightCard flight={data.flight} />
      ) : (
        <div className="rounded-2xl border border-dashed border-hairline p-6 text-center text-sm text-ink-muted">
          {data.ready
            ? "No upcoming flight on this booking."
            : "Loading your trip…"}
        </div>
      )}
      <SeatMap seatMap={data.seatMap} onSelectSeat={data.selectSeat} />

      {data.boardingPass ? (
        <BoardingPass pass={data.boardingPass} />
      ) : (
        <div className="rounded-2xl border border-dashed border-hairline p-6 text-center text-sm text-ink-muted">
          Pick a seat, then ask the concierge to issue your boarding pass.
        </div>
      )}
    </div>
  );
}
