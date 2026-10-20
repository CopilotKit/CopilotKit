"use client";

import React from "react";

import { SubAgentName } from "./delegation-log";

// @region[active-subagent-banner]
// Compact sticky banner at the top of the chat panel that names the
// currently-running sub-agent + task. Keeps the user oriented even
// when the per-message activity card has scrolled out of view.
export function SupervisorActivityBanner({
  subAgent,
  task,
}: {
  subAgent: SubAgentName;
  task: string;
}) {
  const labels: Record<SubAgentName, string> = {
    research_agent: "Researcher",
    writing_agent: "Writer",
    critique_agent: "Critic",
  };
  return (
    <div
      data-testid="active-subagent-banner"
      className="flex items-start gap-2 border-b border-[#E9E9EF] bg-[#FAFAFC] px-4 py-2"
    >
      <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#010507]" />
      <div className="min-w-0 text-xs text-[#010507]">
        <span className="font-semibold">{labels[subAgent]}</span>
        <span className="text-[#57575B]"> is running:</span>{" "}
        <span className="text-[#57575B] line-clamp-2">{task}</span>
      </div>
    </div>
  );
}
// @endregion[active-subagent-banner]
