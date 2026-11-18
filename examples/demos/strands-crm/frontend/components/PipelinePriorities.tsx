"use client";
import { useState } from "react";
import { Search, Mail, ChevronRightIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "../lib/crm";
import type { Stage } from "../lib/crm";

export interface PrioritizedDeal {
  dealId: string;
  dealName: string;
  accountName: string;
  stage: Stage;
  amount: number;
  probability: number;
  risk: "low" | "medium" | "high";
  daysToClose: number;
  score: number;
  reason: string;
  nextStep: string;
}

export interface PipelinePlan {
  generatedAt: string;
  totalOpen: number;
  /** "all" = whole pipeline ("Today's focus"); "at_risk" = deals needing attention. */
  focus?: "all" | "at_risk";
  priorities: PrioritizedDeal[];
  /** Remaining ranked deals beyond the top N (revealed by "Show more"). */
  rest?: PrioritizedDeal[];
}

/**
 * The one primary action that best fits a deal's stage. Early-stage deals want
 * research; mid/late-stage deals want a follow-up. Each returns a templated
 * message sent to the copilot via `onAction`.
 */
function primaryAction(deal: PrioritizedDeal): {
  label: string;
  icon: typeof Search;
  message: string;
} {
  if (deal.stage === "Lead" || deal.stage === "Qualified") {
    return {
      label: "Research",
      icon: Search,
      message: `Research ${deal.accountName} and share talking points for the ${deal.dealName} deal.`,
    };
  }
  return {
    label: "Draft follow-up",
    icon: Mail,
    message: `Draft a follow-up email for the ${deal.dealName} deal.`,
  };
}

function PriorityRow({
  deal,
  rank,
  onOpen,
  onAction,
}: {
  deal: PrioritizedDeal;
  rank: number;
  onOpen?: (dealId: string) => void;
  onAction?: (message: string) => void;
}) {
  const primary = primaryAction(deal);
  const PrimaryIcon = primary.icon;
  return (
    <li className="flex gap-3">
      {/* Rank number */}
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        {/* Deal name + account */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="font-semibold text-foreground">
              {deal.dealName}
            </span>
            <span className="ml-1.5 text-xs text-muted-foreground">
              {deal.accountName}
            </span>
          </div>
          {/* Amount + probability */}
          <div className="flex shrink-0 items-center gap-2 tabular-nums">
            <span className="font-semibold">{formatCurrency(deal.amount)}</span>
            <span className="text-muted-foreground">{deal.probability}%</span>
          </div>
        </div>

        {/* Stage + risk chip */}
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{deal.stage}</span>
          <span
            className="text-xs font-medium"
            style={{ color: `var(--risk-${deal.risk})` }}
          >
            Risk: {deal.risk}
          </span>
          {deal.daysToClose >= 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {deal.daysToClose}d to close
            </span>
          )}
        </div>

        {/* Reason */}
        <p className="mt-1 text-xs text-muted-foreground leading-snug">
          {deal.reason}
        </p>

        {/* Next step */}
        <div className="mt-1 text-xs text-muted-foreground/70">
          <span className="font-medium text-muted-foreground">Next:</span>{" "}
          {deal.nextStep}
        </div>

        {/* CTAs — contextual primary + quiet Open */}
        {(onAction || onOpen) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {onAction && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onAction(primary.message)}
              >
                <PrimaryIcon />
                {primary.label}
              </Button>
            )}
            {onOpen && (
              <Button
                size="xs"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => onOpen(deal.dealId)}
              >
                Open
                <ChevronRightIcon />
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function PipelinePriorities({
  plan,
  status,
  onOpen,
  onAction,
}: {
  plan?: PipelinePlan;
  status: string;
  onOpen?: (dealId: string) => void;
  onAction?: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (status !== "complete") {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Reviewing your pipeline…
      </div>
    );
  }

  const atRisk = (plan?.focus ?? "all") === "at_risk";

  if (!plan || !plan.priorities?.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        {atRisk
          ? "No deals need attention right now."
          : "No open deals to prioritize."}
      </div>
    );
  }

  const { priorities, totalOpen } = plan;
  const rest = plan.rest ?? [];
  const title = atRisk ? "At-risk deals" : "Today's focus";
  const countLabel = atRisk
    ? `${priorities.length + rest.length} need attention`
    : `${priorities.length} of ${totalOpen} open deals`;

  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          {atRisk && (
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--risk-high)" }}
              aria-hidden
            />
          )}
          {title}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {countLabel}
        </span>
      </div>

      <ol className="space-y-3">
        {priorities.map((deal, idx) => (
          <PriorityRow
            key={deal.dealId}
            deal={deal}
            rank={idx + 1}
            onOpen={onOpen}
            onAction={onAction}
          />
        ))}
        {expanded &&
          rest.map((deal, idx) => (
            <PriorityRow
              key={deal.dealId}
              deal={deal}
              rank={priorities.length + idx + 1}
              onOpen={onOpen}
              onAction={onAction}
            />
          ))}
      </ol>

      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-3 flex w-full items-center justify-center gap-1 rounded-md border border-border/60 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Show less" : `Show ${rest.length} more`}
        </button>
      )}
    </div>
  );
}
