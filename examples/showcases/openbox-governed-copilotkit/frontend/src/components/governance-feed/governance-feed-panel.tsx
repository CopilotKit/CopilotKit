"use client";

import { useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  ListTree,
  Lock,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGovernanceFeed } from "@/lib/governance-feed/use-governance-feed";
import { VERDICT_STYLE } from "@/lib/governance-feed/verdict-style";
import { pillarLabel } from "@/lib/governance-feed/pillars";
import type {
  ActionNode,
  RunNode,
  StepNode,
} from "@/lib/governance-feed/types";
import { JsonTree } from "./json-tree";

export function GovernanceFeedPanel() {
  const { runs, halted, reset } = useGovernanceFeed();
  const actionCount = runs.reduce((sum, run) => sum + run.actions.length, 0);

  return (
    <aside
      data-testid="openbox-governance-feed"
      className="openbox-feed flex h-full min-h-0 flex-col rounded-md border border-[var(--border)] bg-[var(--card)]"
    >
      <header className="shrink-0 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListTree size={16} aria-hidden="true" />
            <h2 className="text-sm font-semibold">Governance Feed</h2>
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
          >
            Reset
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Live OpenBox execution tree — runs, governed actions, timing, and the
          Authorize pillars.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1">
            <Workflow size={12} aria-hidden="true" /> {runs.length} runs
          </span>
          <span className="inline-flex items-center gap-1">
            <Activity size={12} aria-hidden="true" /> {actionCount} actions
          </span>
          {halted ? (
            <span className="inline-flex items-center gap-1 text-[var(--openbox-feed-halt)]">
              <Lock size={12} aria-hidden="true" /> session halted
            </span>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {runs.length === 0 ? (
          <p
            data-testid="openbox-feed-empty"
            className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]"
          >
            No governed actions yet. Run a workflow to populate the tree.
          </p>
        ) : (
          runs.map((run) => <RunRow key={run.id} run={run} />)
        )}
      </div>
    </aside>
  );
}

function RunRow({ run }: { run: RunNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="openbox-feed-run mb-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--secondary)]"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <GitBranch size={14} aria-hidden="true" />
        <span className="text-xs font-semibold">{run.label}</span>
        <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
          {run.actions.length} actions
        </span>
      </button>
      {open ? (
        <div className="openbox-feed-children ml-3 border-l border-[var(--border)] pl-3">
          {run.actions.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionRow({
  action,
  continuation = false,
}: {
  action: ActionNode;
  continuation?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const style = VERDICT_STYLE[action.verdict];
  const Icon = style.icon;
  const isReviewing = action.verdict === "reviewing";

  return (
    <div
      className={cn("openbox-feed-action py-1.5", continuation && "opacity-95")}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={open ? "Collapse action" : "Expand action"}
        >
          {open ? (
            <ChevronDown size={13} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {continuation ? (
              <span className="text-[10px] uppercase text-[var(--muted-foreground)]">
                resume
              </span>
            ) : null}
            <span className="truncate text-xs font-semibold">
              {action.title}
            </span>
            <span
              className={cn(style.badgeClass, isReviewing && "animate-pulse")}
              data-testid={`openbox-feed-verdict-${action.verdict}`}
            >
              <Icon size={11} aria-hidden="true" />
              {style.label}
            </span>
            <span className="openbox-feed-pillar" data-pillar={action.pillar}>
              {pillarLabel(action.pillar)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">
            {action.reason || action.request}
          </p>

          {open ? (
            <div className="mt-2 space-y-2">
              {action.redactionSummary ? (
                <p className="text-[11px] text-[var(--openbox-feed-constrain)]">
                  Sensitive data adjusted before this result was shown.
                </p>
              ) : null}
              {action.steps.length > 0 ? (
                <ul className="space-y-1">
                  {action.steps.map((step) => (
                    <StepRow key={step.id} step={step} />
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  No timing sub-steps recorded.
                </p>
              )}
              <button
                type="button"
                className="text-[11px] underline text-[var(--muted-foreground)]"
                onClick={() => setShowJson((prev) => !prev)}
              >
                {showJson ? "Hide raw result" : "Show raw result"}
              </button>
              {showJson ? (
                <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2">
                  <JsonTree value={action.raw} defaultOpen />
                </div>
              ) : null}
            </div>
          ) : null}

          {action.continuation ? (
            <div className="mt-2 border-l border-dashed border-[var(--border)] pl-2">
              <ActionRow action={action.continuation} continuation />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StepRow({ step }: { step: StepNode }) {
  return (
    <li className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
      <Clock size={11} aria-hidden="true" />
      <span className="truncate">{step.label}</span>
      <span className="ml-auto tabular-nums">
        {step.pending ? "…" : formatMs(step.ms)}
      </span>
    </li>
  );
}

function formatMs(ms?: number): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
