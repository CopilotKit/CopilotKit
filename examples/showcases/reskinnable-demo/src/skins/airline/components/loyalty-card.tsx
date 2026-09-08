"use client";

import { Star } from "lucide-react";
import type { LoyaltyStatus } from "../data/types";
import { tierStyleOf, cn } from "./utils";

interface LoyaltyCardProps {
  loyalty: LoyaltyStatus;
}

export function LoyaltyCard({ loyalty }: LoyaltyCardProps) {
  const tier = tierStyleOf(loyalty.tier);
  const tierTotal =
    loyalty.miles + loyalty.miles_to_next_tier > 0
      ? loyalty.miles + loyalty.miles_to_next_tier
      : loyalty.miles;
  const progress =
    loyalty.next_tier && tierTotal > 0
      ? Math.min(100, Math.round((loyalty.miles / tierTotal) * 100))
      : 100;

  return (
    <div
      className={cn(
        "rounded-2xl bg-gradient-to-br p-6 text-white shadow-lift",
        tier.gradient,
      )}
    >
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest opacity-80">
            <Star className="h-3 w-3 fill-white" />
            Aeronova Club
          </div>
          <div className="mt-0.5 text-lg font-semibold">
            {loyalty.member_name}
          </div>
          <div className="font-mono text-xs opacity-80">
            {loyalty.member_id}
          </div>
        </div>
        <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ring-1 ring-white/30">
          {tier.label}
        </span>
      </div>

      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">
            {loyalty.miles.toLocaleString()}
          </span>
          <span className="text-sm opacity-80">miles</span>
        </div>
        <div className="mt-0.5 text-xs opacity-80">
          {loyalty.segments_this_year} segments flown this year
        </div>
      </div>

      {loyalty.next_tier ? (
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-[11px] opacity-90">
            <span>Progress to {loyalty.next_tier.toUpperCase()}</span>
            <span className="font-mono">
              {loyalty.miles_to_next_tier.toLocaleString()} to go
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="mb-4 text-xs opacity-90">
          You&apos;ve reached the top tier — thanks for flying with us.
        </div>
      )}

      {Array.isArray(loyalty.benefits) && loyalty.benefits.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-white/20 pt-3">
          {loyalty.benefits.map((b) => (
            <span
              key={b}
              className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] ring-1 ring-white/20"
            >
              {b}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
