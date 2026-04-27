"use client";

import React from "react";

export interface Delegation {
  id: string;
  sub_agent: "research_agent" | "writing_agent" | "critique_agent";
  task: string;
  status: "running" | "completed" | "failed";
  result: string;
}

const SUB_AGENT_BADGE_CLASS: Record<Delegation["sub_agent"], string> = {
  research_agent: "bg-blue-50 text-blue-700 border-blue-200",
  writing_agent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  critique_agent: "bg-purple-50 text-purple-700 border-purple-200",
};

const SUB_AGENT_LABEL: Record<Delegation["sub_agent"], string> = {
  research_agent: "Research",
  writing_agent: "Writing",
  critique_agent: "Critique",
};

export function DelegationLog({ delegations }: { delegations: Delegation[] }) {
  return (
    <div
      data-testid="delegation-log"
      className="h-full flex flex-col rounded-2xl bg-white border border-[#DBDBE5] shadow-sm"
    >
      <header className="px-5 py-3 border-b border-[#E9E9EF]">
        <h2 className="text-sm font-semibold text-[#010507]">Delegation log</h2>
        <p className="text-xs text-[#838389] mt-0.5">
          Each entry shows a sub-agent invocation by the supervisor.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {delegations.length === 0 ? (
          <p className="text-sm text-[#838389] italic">
            No delegations yet. Ask the supervisor to plan a deliverable.
          </p>
        ) : (
          delegations.map((d) => (
            <article
              key={d.id}
              data-testid="delegation-entry"
              className="rounded-xl border border-[#E9E9EF] bg-[#FAFAFC] p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${SUB_AGENT_BADGE_CLASS[d.sub_agent]}`}
                >
                  {SUB_AGENT_LABEL[d.sub_agent]}
                </span>
                <span className="text-[11px] uppercase tracking-wider text-[#838389]">
                  {d.status}
                </span>
              </div>
              <div className="text-xs text-[#57575B] mb-2">
                <strong className="text-[#010507]">Task:</strong> {d.task}
              </div>
              <div className="text-xs text-[#010507] whitespace-pre-wrap">
                {d.result}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
