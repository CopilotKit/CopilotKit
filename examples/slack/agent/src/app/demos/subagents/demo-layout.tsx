"use client";

import React from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";

import { Delegation, SubAgentName, DelegationLog } from "./delegation-log";
import { SupervisorActivityBanner } from "./supervisor-activity-banner";

interface DemoLayoutProps {
  delegations: Delegation[];
  isRunning: boolean;
  activeSubAgent: { subAgent: SubAgentName; task: string } | null;
}

export function DemoLayout({
  delegations,
  isRunning,
  activeSubAgent,
}: DemoLayoutProps) {
  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-50">
      <section className="flex-1 min-h-0 p-4">
        <DelegationLog delegations={delegations} isRunning={isRunning} />
      </section>
      <aside className="md:w-[420px] md:shrink-0 flex flex-col min-h-0 border-l border-[#DBDBE5] bg-white">
        {activeSubAgent && (
          <SupervisorActivityBanner
            subAgent={activeSubAgent.subAgent}
            task={activeSubAgent.task}
          />
        )}
        <CopilotChat
          agentId="subagents"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Give the supervisor a task...",
          }}
        />
      </aside>
    </div>
  );
}
