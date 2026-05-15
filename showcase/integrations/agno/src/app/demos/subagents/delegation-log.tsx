"use client";

import React from "react";

export type SubAgentName =
  | "research_agent"
  | "writing_agent"
  | "critique_agent";

export interface Delegation {
  id: string;
  sub_agent: SubAgentName;
  task: string;
  status: "running" | "completed" | "failed";
  result: string;
}

const SUB_AGENT_BADGE_CLASS: Record<SubAgentName, string> = {
  research_agent: "bg-blue-50 text-blue-700 border-blue-200",
  writing_agent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  critique_agent: "bg-purple-50 text-purple-700 border-purple-200",
};

const SUB_AGENT_LABEL: Record<SubAgentName, string> = {
  research_agent: "Research",
  writing_agent: "Writing",
  critique_agent: "Critique",
};

const STATUS_BADGE_CLASS: Record<Delegation["status"], string> = {
  running: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABEL: Record<Delegation["status"], string> = {
  running: "running…",
  completed: "completed",
  failed: "failed",
};

const ENTRY_BORDER_BY_STATUS: Record<Delegation["status"], string> = {
  running: "border-amber-200 bg-amber-50/40",
  completed: "border-[#E9E9EF] bg-[#FAFAFC]",
  failed: "border-red-200 bg-red-50/40",
};

export interface DelegationLogProps {
  delegations: Delegation[];
  /** True while the supervisor is actively running. */
  isRunning?: boolean;
}

// @region[delegation-log-frontend]
/**
 * Live delegation log — renders the `delegations` slot of agent state.
 *
 * Each entry corresponds to one invocation of a sub-agent. The list grows
 * in real time as the supervisor fans work out to its children: the agno
 * supervisor's tools push entries with status `"running"` before invoking
 * the sub-agent, then flip them to `"completed"` or `"failed"` once the
 * sub-agent returns.
 */
export function DelegationLog({ delegations, isRunning }: DelegationLogProps) {
  return (
    <div
      data-testid="delegation-log"
      className="h-full flex flex-col rounded-2xl bg-white border border-[#DBDBE5] shadow-sm"
    >
      <header className="px-5 py-3 border-b border-[#E9E9EF] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#010507]">
            Sub-agent delegations
          </h2>
          <p className="text-xs text-[#838389] mt-0.5">
            Each entry shows a sub-agent invocation by the supervisor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span
              data-testid="supervisor-running"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-[10px] font-semibold uppercase tracking-[0.12em]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
              Supervisor running
            </span>
          )}
          <span
            data-testid="delegation-count"
            className="text-xs font-mono text-[#838389]"
          >
            {delegations.length} calls
          </span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {delegations.length === 0 ? (
          <p
            data-testid="delegation-empty"
            className="text-sm text-[#838389] italic"
          >
            No delegations yet. Ask the supervisor to plan a deliverable.
          </p>
        ) : (
          delegations.map((d, idx) => (
            <article
              key={d.id}
              data-testid="delegation-entry"
              data-status={d.status}
              className={`rounded-xl border p-3 ${ENTRY_BORDER_BY_STATUS[d.status]}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-[#AFAFB7]">
                  #{idx + 1}
                </span>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${SUB_AGENT_BADGE_CLASS[d.sub_agent]}`}
                >
                  {SUB_AGENT_LABEL[d.sub_agent]}
                </span>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS_BADGE_CLASS[d.status]}`}
                >
                  {STATUS_LABEL[d.status]}
                </span>
              </div>
              <div className="text-xs text-[#57575B] mb-2">
                <strong className="text-[#010507]">Task:</strong> {d.task}
              </div>
              {d.status === "running" ? (
                <div className="flex items-center gap-2 text-xs text-amber-700">
                  <span
                    className="inline-block w-3 h-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin"
                    aria-hidden
                  />
                  Sub-agent is working…
                </div>
              ) : (
                <div
                  className={`text-xs whitespace-pre-wrap ${
                    d.status === "failed" ? "text-red-700" : "text-[#010507]"
                  }`}
                >
                  {d.result}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
// @endregion[delegation-log-frontend]
