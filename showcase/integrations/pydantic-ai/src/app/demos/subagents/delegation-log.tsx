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

export interface DelegationLogProps {
  delegations: Delegation[];
  /** True while the supervisor is actively running. */
  isRunning: boolean;
}

const SUB_AGENT_STYLE: Record<
  SubAgentName,
  { label: string; color: string; emoji: string }
> = {
  research_agent: {
    label: "Research",
    color: "bg-[#BEC2FF1A] text-[#010507] border-[#BEC2FF]",
    emoji: "🔎",
  },
  writing_agent: {
    label: "Writing",
    color: "bg-[#85ECCE]/15 text-[#189370] border-[#85ECCE4D]",
    emoji: "✍️",
  },
  critique_agent: {
    label: "Critique",
    color: "bg-[#FFAC4D]/12 text-[#010507] border-[#FFAC4D33]",
    emoji: "🧐",
  },
};

const STATUS_STYLE: Record<Delegation["status"], string> = {
  running: "text-[#838389]",
  completed: "text-[#189370]",
  failed: "text-[#FA5F67]",
};

// @region[delegation-log-frontend]
/**
 * Live delegation log — renders the `delegations` slot of agent state.
 *
 * Each entry corresponds to one invocation of a sub-agent. The list
 * grows in real time as the supervisor fans work out to its children.
 * The parent header shows how many sub-agents have been called and
 * whether the supervisor is still running.
 */
export function DelegationLog({ delegations, isRunning }: DelegationLogProps) {
  return (
    <div
      data-testid="delegation-log"
      className="w-full h-full flex flex-col bg-white rounded-2xl shadow-sm border border-[#DBDBE5] overflow-hidden"
    >
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#E9E9EF] bg-[#FAFAFC]">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-[#010507]">
            Sub-agent delegations
          </span>
          {isRunning && (
            <span
              data-testid="supervisor-running"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[#BEC2FF] bg-[#BEC2FF1A] text-[#010507] text-[10px] font-semibold uppercase tracking-[0.12em]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#010507] animate-pulse" />
              Supervisor running
            </span>
          )}
        </div>
        <span
          data-testid="delegation-count"
          className="text-xs font-mono text-[#838389]"
        >
          {delegations.length} calls
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {delegations.length === 0 ? (
          <p className="text-[#838389] italic text-sm">
            Ask the supervisor to complete a task. Every sub-agent it calls will
            appear here.
          </p>
        ) : (
          delegations.map((d, idx) => {
            const style = SUB_AGENT_STYLE[d.sub_agent];
            return (
              <div
                key={d.id}
                data-testid="delegation-entry"
                className="border border-[#E9E9EF] rounded-xl p-3 bg-[#FAFAFC]"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[#AFAFB7]">
                      #{idx + 1}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] border ${style.color}`}
                    >
                      <span>{style.emoji}</span>
                      <span>{style.label}</span>
                    </span>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-[0.12em] font-semibold ${STATUS_STYLE[d.status]}`}
                  >
                    {d.status}
                  </span>
                </div>
                <div className="text-xs text-[#57575B] mb-2">
                  <span className="font-semibold text-[#010507]">Task: </span>
                  {d.task}
                </div>
                {d.result ? (
                  <div className="text-sm text-[#010507] whitespace-pre-wrap bg-white rounded-lg p-2.5 border border-[#E9E9EF]">
                    {d.result}
                  </div>
                ) : (
                  <div className="text-xs italic text-[#838389]">
                    Sub-agent is working...
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
// @endregion[delegation-log-frontend]
