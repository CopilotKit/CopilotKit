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
    color: "bg-blue-100 text-blue-800 border-blue-300",
    emoji: "🔎",
  },
  writing_agent: {
    label: "Writing",
    color: "bg-purple-100 text-purple-800 border-purple-300",
    emoji: "✍️",
  },
  critique_agent: {
    label: "Critique",
    color: "bg-amber-100 text-amber-800 border-amber-300",
    emoji: "🧐",
  },
};

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
      className="w-full h-full flex flex-col bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden"
    >
      <div className="flex items-center justify-between px-6 py-3 border-b bg-gradient-to-r from-indigo-50 to-purple-50">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-gray-800">
            Sub-Agent Delegations
          </span>
          {isRunning && (
            <span
              data-testid="supervisor-running"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500 text-white text-[10px] font-bold tracking-wide"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              SUPERVISOR RUNNING
            </span>
          )}
        </div>
        <span
          data-testid="delegation-count"
          className="text-xs font-mono text-gray-500"
        >
          {delegations.length} calls
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {delegations.length === 0 ? (
          <p className="text-gray-400 italic text-sm">
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
                className="border border-gray-200 rounded-xl p-3 bg-gray-50/60"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-400">
                      #{idx + 1}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${style.color}`}
                    >
                      <span>{style.emoji}</span>
                      <span>{style.label}</span>
                    </span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide font-bold text-green-600">
                    {d.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mb-1">
                  <span className="font-semibold text-gray-600">Task: </span>
                  {d.task}
                </div>
                <div className="text-sm text-gray-800 whitespace-pre-wrap bg-white rounded p-2 border border-gray-200">
                  {d.result}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
