"use client";

import { useSkinData } from "@/shell/skin-provider";
import type { AirlineData } from "../data/types";
import { FlightCard, SeatMap, BoardingPass } from "../components";

export function TripsPage() {
  const data = useSkinData<AirlineData>();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Your trip</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Check in, choose a seat, and get your boarding pass.
        </p>
      </div>

      <FlightCard flight={data.flight} />
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
