"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { useSkinData } from "@/shell/skin-provider";
import type { AirlineData } from "../data/types";
import { LoyaltyCard, RedemptionList } from "../components";

export function LoyaltyPage() {
  const data = useSkinData<AirlineData>();

  // ── BEAT 3b, part 2 — what is VISIBLY on this screen ─────────────────────
  // `rows` maps `data.redemptions` — the SAME array handed to <RedemptionList>
  // below, in the same order. Never a second slice of the same source: a
  // readable listing 5 against a panel painting 6 makes the agent describe the
  // screen wrongly and silently (demo-beats.md § 3b).
  //
  // ONE MECHANICAL CONSTRAINT before rewording any of this: `readables.test.tsx`
  // anchors its omission guard on a `useAgentContext(` window terminated by the
  // statement's own semicolon, so a SEMICOLON in the description below ends that
  // window early and fails the guard for reasons the message will not explain.
  // Use dashes and full stops.
  useAgentContext({
    description:
      "What is on the Aeronova Club screen right now — the passenger's tier " +
      "and mileage balance, and the redemption options on offer. `visible` is " +
      "how many `rows` are on screen, in the order shown.",
    value: JSON.stringify({
      page: "Aeronova Club",
      loyalty: {
        member: data.loyalty.member_name,
        member_id: data.loyalty.member_id,
        tier: data.loyalty.tier,
        miles: data.loyalty.miles,
        miles_to_next_tier: data.loyalty.miles_to_next_tier,
        next_tier: data.loyalty.next_tier,
        segments_this_year: data.loyalty.segments_this_year,
        benefits: data.loyalty.benefits,
      },
      visible: data.redemptions.length,
      rows: data.redemptions.map((r) => ({
        title: r.title,
        category: r.category,
        miles_required: r.miles_required,
      })),
    }),
  });

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
