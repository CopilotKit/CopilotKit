"use client";

import { Plane } from "lucide-react";
import type { BoardingPass as BoardingPassModel } from "../data/types";

interface BoardingPassProps {
  pass: BoardingPassModel;
}

function Barcode({ data }: { data: string }) {
  const safe = typeof data === "string" && data.length > 0 ? data : "----";
  const stripes = Array.from(safe).map((ch, i) => {
    const code = ch.charCodeAt(0);
    const w = (code % 4) + 1;
    const isDark = (code + i) % 3 !== 0;
    return { w, isDark, k: i };
  });
  return (
    <div className="flex h-12 items-stretch gap-[1px] rounded bg-white p-1.5">
      {stripes.map((s) => (
        <div
          key={s.k}
          style={{ width: `${s.w}px` }}
          className={s.isDark ? "bg-black" : "bg-white"}
        />
      ))}
    </div>
  );
}

export function BoardingPass({ pass }: BoardingPassProps) {
  return (
    <div className="brand-gradient overflow-hidden rounded-2xl text-brand-foreground shadow-lift">
      <div className="flex p-6">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-widest text-brand-foreground/80">
            <Plane className="h-3.5 w-3.5" />
            Boarding Pass
          </div>
          <div className="mb-6 flex items-start justify-between gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-brand-foreground/70">
                Passenger
              </div>
              <div className="text-lg font-semibold leading-tight">
                {pass.passenger_name}
              </div>
              <div className="mt-0.5 font-mono text-xs text-brand-foreground/80">
                PNR {pass.pnr}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-brand-foreground/70">
                Flight
              </div>
              <div className="text-lg font-semibold">{pass.flight_number}</div>
            </div>
          </div>

          <div className="mb-6 flex items-end justify-between gap-4">
            <div className="text-4xl font-bold tracking-tight">
              {pass.origin}
            </div>
            <Plane className="mb-2 h-5 w-5 text-brand-foreground/80" />
            <div className="text-right text-4xl font-bold tracking-tight">
              {pass.destination}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-brand-foreground/70">
                Seat
              </div>
              <div className="font-mono text-lg font-bold">{pass.seat}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-brand-foreground/70">
                Gate
              </div>
              <div className="font-mono text-lg font-bold">{pass.gate}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-brand-foreground/70">
                Boarding
              </div>
              <div className="font-mono text-lg font-bold">
                {pass.boarding_time}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-4 hidden items-center md:flex">
          <div className="h-full w-px border-l border-dashed border-brand-foreground/40" />
        </div>

        <div className="hidden min-w-[140px] flex-col items-center justify-between md:flex">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-brand-foreground/70">
              Sequence
            </div>
            <div className="font-mono text-3xl font-bold">
              {(pass.sequence ?? 0).toString().padStart(3, "0")}
            </div>
          </div>
          <div className="w-full">
            <Barcode data={pass.barcode_data} />
            <div className="mt-1 text-center font-mono text-[10px] text-brand-foreground/80">
              {pass.barcode_data}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
