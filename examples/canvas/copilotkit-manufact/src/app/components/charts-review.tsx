"use client";

/**
 * /components/charts-review.tsx
 *
 * Visual design review for the chart/visualization render tools:
 *   - LeadRadar (per-lead 5-axis profile)
 *   - TierDonut (portfolio split by tier)
 *   - ScoreDistribution (histogram of scores, stacked by tier)
 *
 * Each chart is a `useFrontendTool({ render })` surface — the agent calls
 * one when its narrative benefits from a picture more than a sentence.
 */

import { LeadRadar } from "@/components/leads/charts/LeadRadar";
import { TierDonut } from "@/components/leads/charts/TierDonut";
import {
  ScoreDistribution,
  bucketScores,
} from "@/components/leads/charts/ScoreDistribution";
import type { Tier } from "@/lib/leads/types";
import {
  ReviewHero,
  ReviewLabel,
  ReviewSubsection,
  ReviewCodeBlock,
} from "./_review-shared";

export function ChartsReview() {
  return (
    <section className="space-y-12">
      <ReviewHero
        eyebrow="Generative UI · charts"
        title="Visualizations"
        body={
          <>
            Three render-only chart components the agent can drop inline in
            chat to make a numerical answer visible. Each one renders from
            its own props (no agent state coupling) so they slot into{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              useFrontendTool({"{"} render {"}"})
            </code>{" "}
            without ceremony. SVG-based, motion/react entrance, palette
            consistent with workshop and tier chips elsewhere in the app.
          </>
        }
      />

      <ReviewSubsection
        eyebrow="Per-lead"
        title="LeadRadar"
        body="Five-axis radar comparing one lead against the ICP target. Filled polygon (lead) over a dashed reference. Use in LeadDetail's Profile tab and as an inline render when the user asks 'why is this one Hot?'"
      >
        <div className="flex flex-wrap gap-6">
          <ReviewLabel label="Hot lead · strong fit">
            <LeadRadar
              leadName="Anna Chen"
              tier="hot"
              score={88}
              axes={{
                copilotKitFit: 0.92,
                langChainFit: 0.78,
                agenticUiInterest: 0.95,
                productionReadiness: 0.62,
                decisionMakerScore: 0.85,
              }}
            />
          </ReviewLabel>
          <ReviewLabel label="Drop · weak fit">
            <LeadRadar
              leadName="Sven Larsen"
              tier="drop"
              score={28}
              axes={{
                copilotKitFit: 0.18,
                langChainFit: 0.22,
                agenticUiInterest: 0.30,
                productionReadiness: 0.10,
                decisionMakerScore: 0.40,
              }}
            />
          </ReviewLabel>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Portfolio"
        title="TierDonut"
        body="Donut split of leads across Hot / Warm / Nurture / Drop. Total in the center; legend reads count + percent. Click a slice to filter the canvas to that tier (when wired)."
      >
        <div className="flex flex-wrap gap-6">
          <ReviewLabel label="Populated · 52 leads">
            <TierDonut
              counts={{ hot: 8, warm: 17, nurture: 19, drop: 8 }}
            />
          </ReviewLabel>
          <ReviewLabel label="Empty / pre-scoring">
            <TierDonut
              counts={{ hot: 0, warm: 0, nurture: 0, drop: 0 }}
            />
          </ReviewLabel>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Portfolio"
        title="ScoreDistribution"
        body="Histogram of scores in 10-point buckets, stacked by tier so the bands are visible at a glance. The dark cluster on the right tells you 'we have 8 Hot leads'; the long tail on the left tells you 'we should drop ~⅕ of the list before drafting.'"
      >
        <div className="flex flex-col gap-4">
          <ReviewLabel label="Populated">
            <ScoreDistribution buckets={MOCK_DISTRIBUTION_FULL} />
          </ReviewLabel>
          <ReviewLabel label="Sparse · early run">
            <ScoreDistribution buckets={MOCK_DISTRIBUTION_SPARSE} />
          </ReviewLabel>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Wiring"
        title="Render tool registration"
        body="All three live inside the page-level useFrontendTool registrations. Each renders from args, not state, so they're safe to call multiple times in one conversation."
      >
        <ReviewCodeBlock>{REGISTRATION_SOURCE}</ReviewCodeBlock>
      </ReviewSubsection>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mock data — declared after the helpers so module init order is safe
// ---------------------------------------------------------------------------

function range<T>(n: number, fn: () => T): T[] {
  const arr: T[] = [];
  for (let i = 0; i < n; i++) arr.push(fn());
  return arr;
}

// Deterministic-ish random for stable repaint. Module-level state lives in
// a closure so `rand` can be called before the `let` is reached at the
// outer scope (it isn't, but keeping the closure side-steps any future
// hoisting surprises in Turbopack).
const rand = (() => {
  let seed = 1;
  return (lo: number, hi: number): number => {
    seed = (seed * 9301 + 49297) % 233280;
    const u = seed / 233280;
    return Math.floor(lo + u * (hi - lo + 1));
  };
})();

const MOCK_DISTRIBUTION_FULL = bucketScores([
  ...range(2, () => ({ score: rand(0, 19), tier: "drop" as Tier })),
  ...range(6, () => ({ score: rand(20, 39), tier: "drop" as Tier })),
  ...range(8, () => ({ score: rand(40, 59), tier: "nurture" as Tier })),
  ...range(11, () => ({ score: rand(60, 74), tier: "warm" as Tier })),
  ...range(7, () => ({ score: rand(75, 89), tier: "warm" as Tier })),
  ...range(8, () => ({ score: rand(85, 100), tier: "hot" as Tier })),
]);

const MOCK_DISTRIBUTION_SPARSE = bucketScores([
  { score: 92, tier: "hot" },
  { score: 88, tier: "hot" },
  { score: 71, tier: "warm" },
  { score: 55, tier: "nurture" },
  { score: 32, tier: "drop" },
]);

// ---------------------------------------------------------------------------
// Source snippet
// ---------------------------------------------------------------------------

const REGISTRATION_SOURCE = `// src/app/page.tsx — chart render tools

useFrontendTool({
  name: "renderLeadRadar",
  description:
    "Render a five-axis radar comparing one lead against the ICP. " +
    "Use when the user asks why a lead is Hot/Drop, or when introducing " +
    "a lead in a Profile context. Pass axes 0..1 per dimension.",
  parameters: z.object({
    leadId: z.string(),
    leadName: z.string().optional(),
    tier: z.enum(["hot", "warm", "nurture", "drop"]).optional(),
    score: z.number().optional(),
    axes: z.object({
      copilotKitFit: z.number(),
      langChainFit: z.number(),
      agenticUiInterest: z.number(),
      productionReadiness: z.number(),
      decisionMakerScore: z.number(),
    }),
  }),
  render: ({ args }) => (
    <LeadRadar
      leadName={args.leadName}
      tier={args.tier}
      score={args.score}
      axes={args.axes}
    />
  ),
});

useFrontendTool({
  name: "renderTierDonut",
  description:
    "Render a donut chart of leads split by tier. Use when the user " +
    "asks 'how do these break down' or 'how many are Hot/Drop.' Counts " +
    "are explicit so the agent can show what-if states without mutating " +
    "anything.",
  parameters: z.object({
    counts: z.object({
      hot: z.number(),
      warm: z.number(),
      nurture: z.number(),
      drop: z.number(),
    }),
  }),
  render: ({ args }) => <TierDonut counts={args.counts} />,
});

useFrontendTool({
  name: "renderScoreDistribution",
  description:
    "Render a 10-bucket histogram of lead scores, stacked by tier. " +
    "Use when the user asks 'show me the score spread' or after a " +
    "rubric change to convey what shifted. Pass buckets directly.",
  parameters: z.object({
    buckets: z.array(z.object({
      start: z.number(),
      end: z.number(),
      byTier: z.object({
        hot: z.number(),
        warm: z.number(),
        nurture: z.number(),
        drop: z.number(),
      }),
    })),
  }),
  render: ({ args }) => <ScoreDistribution buckets={args.buckets} />,
});`;
