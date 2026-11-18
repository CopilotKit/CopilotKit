"use client";

import type { RedemptionOption } from "../data/types";
import { Button } from "@/components/ui/button";
import { lookup } from "./utils";

const FALLBACK_CATEGORY = "bg-surface-muted text-ink-muted";

interface RedemptionListProps {
  redemptions: RedemptionOption[];
  onRedeem?: (id: string) => void;
}

const CATEGORY_STYLE: Record<RedemptionOption["category"], string> = {
  flight: "bg-brand-soft text-brand",
  upgrade: "bg-purple-100 text-purple-700",
  lounge: "bg-amber-100 text-amber-700",
  merchandise: "bg-surface-muted text-ink-muted",
  hotel: "bg-positive-soft text-positive",
};

export function RedemptionList({ redemptions, onRedeem }: RedemptionListProps) {
  if (redemptions.length === 0) {
    return null;
  }
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-soft">
      <div className="mb-4 text-xs uppercase tracking-wider text-ink-muted">
        Redemption options
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {redemptions.map((r) => (
          <div
            key={r.id}
            className="flex flex-col gap-2 rounded-xl border border-hairline p-4 transition-colors hover:border-brand/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-3xl">{r.emoji}</div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${lookup(CATEGORY_STYLE, r.category, FALLBACK_CATEGORY)}`}
              >
                {r.category || "reward"}
              </span>
            </div>
            <div>
              <div className="font-semibold leading-tight text-ink">
                {r.title}
              </div>
              <div className="mt-1 text-xs leading-snug text-ink-muted">
                {r.description}
              </div>
            </div>
            <div className="mt-auto flex items-center justify-between pt-2">
              <div className="font-mono text-sm font-semibold text-ink">
                {r.miles_required.toLocaleString()} mi
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={onRedeem ? () => onRedeem(r.id) : undefined}
              >
                Redeem
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
