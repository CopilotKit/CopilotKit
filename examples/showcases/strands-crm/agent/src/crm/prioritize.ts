/**
 * Pipeline prioritization: rank open deals by risk + value + urgency + stage.
 *
 * Scoring formula (documented so the rationale is transparent in demos):
 *
 *   score =  riskWeight  * 1000         // risk dominates (high=3, medium=2, low=1)
 *          + amount / 1000              // value breaks ties within the same risk tier
 *          + urgencyBonus               // overdue=400, <14d=200, <30d=80, else 0
 *          + stageBonus                 // later stage ≈ closer to revenue
 *                                       //   Negotiation=60, Proposal=40, Qualified=20, Lead=0
 *
 * Risk thresholds are reused verbatim from brief.ts (the single source of truth):
 *   closed         → low  (n/a here — open deals only)
 *   prob<35 || daysToClose<0   → high
 *   prob<65 || daysToClose<14  → medium
 *   else                        → low
 */

import type { CrmStore } from "./store.js";
import type { Stage } from "./types.js";
import { OPEN_STAGES } from "./types.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PrioritizedDeal {
  dealId: string;
  dealName: string;
  accountName: string;
  stage: Stage;
  amount: number;
  probability: number;
  risk: "low" | "medium" | "high";
  /** Floor of days until closeDate; negative means overdue. */
  daysToClose: number;
  /** Ranking score — higher = more urgent/important. Useful for debugging. */
  score: number;
  /** One-line human rationale for why this deal is prioritized. */
  reason: string;
  /** Concrete suggested next action, reused from brief.ts stage→action mapping. */
  nextStep: string;
}

export interface PipelinePlan {
  /** ISO timestamp of when this plan was generated. */
  generatedAt: string;
  /** Total open deals considered (before topN truncation). */
  totalOpen: number;
  /** Which lens produced this plan: the whole pipeline or just at-risk deals. */
  focus: "all" | "at_risk";
  /** Top N deals sorted by score descending. */
  priorities: PrioritizedDeal[];
  /** Remaining ranked deals beyond the top N (for "show more"). */
  rest: PrioritizedDeal[];
}

// ---------------------------------------------------------------------------
// Internal helpers (mirroring brief.ts thresholds exactly)
// ---------------------------------------------------------------------------

function computeRisk(
  probability: number,
  daysToClose: number,
): "low" | "medium" | "high" {
  // Note: we only call this for open deals, so the "closed → low" branch is not needed.
  if (probability < 35 || daysToClose < 0) return "high";
  if (probability < 65 || daysToClose < 14) return "medium";
  return "low";
}

const RISK_WEIGHT: Record<"low" | "medium" | "high", number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const STAGE_BONUS: Partial<Record<Stage, number>> = {
  Negotiation: 60,
  Proposal: 40,
  Qualified: 20,
  Lead: 0,
};

function urgencyBonus(daysToClose: number): number {
  if (daysToClose < 0) return 400;
  if (daysToClose < 14) return 200;
  if (daysToClose < 30) return 80;
  return 0;
}

/** Stage → suggested next step (reused from brief.ts). */
function stageNextStep(stage: Stage): string {
  switch (stage) {
    case "Lead":
      return "Qualify: confirm budget, authority, need, timeline.";
    case "Qualified":
      return "Send a tailored proposal.";
    case "Proposal":
      return "Confirm pricing and start negotiation.";
    case "Negotiation":
      return "Address final blockers and request verbal commit.";
    default:
      return "No action — deal is closed.";
  }
}

function buildReason(
  risk: "low" | "medium" | "high",
  amount: number,
  stage: Stage,
  daysToClose: number,
): string {
  const amtK = `$${Math.round(amount / 1000)}k`;
  const timing =
    daysToClose < 0 ? `${-daysToClose}d overdue` : `closes in ${daysToClose}d`;
  const prefix = risk === "high" ? "At risk — " : "";
  return `${prefix}${amtK} in ${stage}, ${timing}`;
}

// ---------------------------------------------------------------------------
// Core ranking function
// ---------------------------------------------------------------------------

/**
 * Rank all OPEN deals in the store and return the top `topN`.
 *
 * @param store  Any CrmStore instance (injected for testability).
 * @param topN   How many priorities to return (default 3).
 * @param now    Current timestamp in ms; defaults to `Date.now()`. Pass a
 *               fixed value in tests for deterministic results.
 * @param focus  "all" (default) ranks every open deal; "at_risk" keeps only
 *               deals whose risk is medium or high.
 */
export function prioritizePipeline(
  store: CrmStore,
  topN = 3,
  now = Date.now(),
  focus: "all" | "at_risk" = "all",
): PipelinePlan {
  const { deals, accounts } = store.getStateSnapshot();

  // Index accounts by id for fast lookup.
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Consider only open deals.
  const openDeals = deals.filter((d) =>
    (OPEN_STAGES as string[]).includes(d.stage),
  );

  const scored: PrioritizedDeal[] = openDeals.map((deal) => {
    const daysToClose = Math.floor(
      (new Date(deal.closeDate).getTime() - now) / 86_400_000,
    );
    const risk = computeRisk(deal.probability, daysToClose);
    const score =
      RISK_WEIGHT[risk] * 1000 +
      deal.amount / 1000 +
      urgencyBonus(daysToClose) +
      (STAGE_BONUS[deal.stage] ?? 0);

    const accountName = accountById.get(deal.accountId)?.name ?? deal.accountId;

    return {
      dealId: deal.id,
      dealName: deal.name,
      accountName,
      stage: deal.stage as Stage,
      amount: deal.amount,
      probability: deal.probability,
      risk,
      daysToClose,
      score,
      reason: buildReason(risk, deal.amount, deal.stage as Stage, daysToClose),
      nextStep: stageNextStep(deal.stage as Stage),
    };
  });

  // Sort descending by score; stable sort by deal id to ensure full determinism.
  scored.sort((a, b) => b.score - a.score || a.dealId.localeCompare(b.dealId));

  // For an at-risk view, drop low-risk deals entirely — they don't "need attention".
  const ranked =
    focus === "at_risk" ? scored.filter((d) => d.risk !== "low") : scored;

  return {
    generatedAt: new Date(now).toISOString(),
    totalOpen: openDeals.length,
    focus,
    priorities: ranked.slice(0, topN),
    rest: ranked.slice(topN),
  };
}
