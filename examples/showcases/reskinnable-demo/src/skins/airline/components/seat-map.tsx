"use client";

import type { SeatMap as SeatMapModel, Seat } from "../data/types";
import { cn, lookup } from "./utils";

interface SeatMapProps {
  seatMap: SeatMapModel;
  onSelectSeat?: (seatId: string) => void;
}

const COLS = ["A", "B", "C", "D", "E", "F"] as const;

const SEAT_CLASS: Record<Seat["status"], string> = {
  available:
    "bg-surface-muted hover:bg-brand-soft hover:ring-brand text-ink cursor-pointer",
  occupied: "bg-ink-muted/50 text-white cursor-not-allowed opacity-70",
  selected:
    "bg-brand text-brand-foreground ring-2 ring-brand-indigo cursor-pointer shadow-md",
  premium: "bg-amber-200 hover:bg-amber-300 text-amber-900 cursor-pointer",
  exit: "bg-positive-soft hover:bg-positive-soft text-positive ring-1 ring-positive cursor-pointer",
  blocked: "bg-negative-soft text-negative cursor-not-allowed opacity-60",
};

function SeatButton({
  seat,
  onSelect,
}: {
  seat: Seat;
  onSelect?: (id: string) => void;
}) {
  const interactive =
    onSelect && seat.status !== "occupied" && seat.status !== "blocked";
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={interactive ? () => onSelect(seat.id) : undefined}
      className={cn(
        "h-7 w-7 rounded-md text-[10px] font-medium transition-all",
        lookup(SEAT_CLASS, seat.status, SEAT_CLASS.available),
      )}
      aria-label={`Seat ${seat.id} (${seat.status})`}
      title={`${seat.id} · ${seat.status}`}
    >
      {seat.column}
    </button>
  );
}

export function SeatMap({ seatMap, onSelectSeat }: SeatMapProps) {
  const byRow = new Map<number, Seat[]>();
  const seats = Array.isArray(seatMap.seats) ? seatMap.seats : [];
  for (const seat of seats) {
    if (!seat || typeof seat.row !== "number") continue;
    const list = byRow.get(seat.row) ?? [];
    list.push(seat);
    byRow.set(seat.row, list);
  }
  const rows = Array.from(byRow.keys()).sort((a, b) => a - b);

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-soft">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">
            Seat Map
          </div>
          <div className="font-semibold text-ink">{seatMap.flight_number}</div>
        </div>
        {seatMap.selected_seat_id ? (
          <div className="text-sm text-ink">
            Selected:{" "}
            <span className="font-mono font-semibold text-brand">
              {seatMap.selected_seat_id}
            </span>
          </div>
        ) : (
          <div className="text-xs text-ink-muted">Pick a seat</div>
        )}
      </div>

      <div className="overflow-auto">
        <div className="inline-block min-w-full">
          <div className="flex gap-1.5 pb-2 pl-7 text-[10px] uppercase text-ink-muted">
            {COLS.map((c, i) => (
              <div key={c} className="flex">
                <div className="h-4 w-7 text-center">{c}</div>
                {i === 2 ? <div className="w-3" /> : null}
              </div>
            ))}
          </div>
          {rows.map((rowNum) => {
            const rowSeats = byRow.get(rowNum) ?? [];
            const byCol = new Map(rowSeats.map((s) => [s.column, s]));
            return (
              <div key={rowNum} className="mb-1.5 flex items-center gap-1.5">
                <div className="w-5 text-right font-mono text-[10px] text-ink-muted">
                  {rowNum}
                </div>
                {COLS.map((col, i) => (
                  <div key={col} className="flex">
                    {byCol.get(col) ? (
                      <SeatButton
                        seat={byCol.get(col)!}
                        onSelect={onSelectSeat}
                      />
                    ) : (
                      <div className="h-7 w-7" />
                    )}
                    {i === 2 ? <div className="w-3" /> : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 border-t border-hairline pt-4 text-[11px] text-ink-muted">
        <Legend cls={SEAT_CLASS.available} label="Available" />
        <Legend cls={SEAT_CLASS.selected} label="Selected" />
        <Legend cls={SEAT_CLASS.premium} label="Premium" />
        <Legend cls={SEAT_CLASS.exit} label="Exit row" />
        <Legend cls={SEAT_CLASS.occupied} label="Occupied" />
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-sm", cls)} />
      {label}
    </div>
  );
}
