"use client";

import { useSkinData } from "@/shell/skin-provider";
import type { AirlineData } from "../data/types";
import { LoyaltyCard, RedemptionList } from "../components";

export function LoyaltyPage() {
  const data = useSkinData<AirlineData>();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Aeronova Club</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your tier, miles, and what you can redeem them for.
        </p>
      </div>

      <LoyaltyCard loyalty={data.loyalty} />
      <RedemptionList redemptions={data.redemptions} />
    </div>
  );
}
