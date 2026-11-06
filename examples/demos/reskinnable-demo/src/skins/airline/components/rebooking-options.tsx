"use client";

import { ArrowRight, Clock } from "lucide-react";
import type { RebookingOption } from "../data/types";
import { Button } from "@/components/ui/button";
import { formatTime, cn } from "./utils";

interface RebookingOptionsProps {
  options: RebookingOption[];
  onSelect?: (id: string) => void;
}

export function RebookingOptions({ options, onSelect }: RebookingOptionsProps) {
  if (options.length === 0) return null;
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-soft">
      <div className="mb-4 text-xs uppercase tracking-wider text-ink-muted">
        Rebooking options
      </div>
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const isFree = o.price_difference === 0;
          return (
            <div
              key={o.id}
              className="flex items-center gap-4 rounded-xl border border-hairline p-4 transition-colors hover:border-brand/50"
            >
              <div className="w-16 font-mono text-sm font-semibold text-ink">
                {o.flight_number}
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
                <span className="font-medium">
                  {formatTime(o.departure_time)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-ink-muted" />
                <span className="font-medium">
                  {formatTime(o.arrival_time)}
                </span>
                <span className="ml-2 flex items-center gap-1 text-xs text-ink-muted">
                  <Clock className="h-3 w-3" />
                  {o.duration}
                </span>
                <span className="ml-2 text-xs text-ink-muted">
                  {o.stops === 0 ? "Nonstop" : `${o.stops} stop`}
                </span>
              </div>

              <div className="hidden text-xs text-ink-muted sm:block">
                {o.seats_available} seats
              </div>

              <span
                className={cn(
                  "rounded-md px-2 py-1 font-mono text-xs font-semibold",
                  isFree
                    ? "bg-positive-soft text-positive"
                    : "bg-amber-100 text-amber-700",
                )}
              >
                {isFree ? "FREE" : `+$${o.price_difference}`}
              </span>

              <Button
                size="sm"
                onClick={onSelect ? () => onSelect(o.id) : undefined}
              >
                Select
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
