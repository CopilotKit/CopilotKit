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

// @region[delegation-log-frontend]
// Live delegation log — renders the `delegations` slot of agent state.
// Each entry corresponds to one invocation of a sub-agent; the list
// grows in real time as the supervisor fans work out to its children.
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
              data-status={d.status}
              className={`rounded-xl border p-3 ${ENTRY_BORDER_BY_STATUS[d.status]}`}
            >
              <div className="flex items-center gap-2 mb-2">
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
