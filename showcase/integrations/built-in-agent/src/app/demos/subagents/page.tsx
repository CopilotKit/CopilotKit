"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useComponent,
} from "@copilotkit/react-core/v2";

import { DelegationLog } from "./delegation-log";
import {
  SubAgentActivityCard,
  type SubAgentActivityCardProps,
} from "./subagent-activity-card";

export default function Subagents() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

// One per-tool render component per sub-agent role. Each captures its
// own `subAgent` identity so the activity card can stamp the per-role
// testid (`subagent-card-<role>`) without needing the tool name to be
// forwarded by `useComponent` render props.
function ResearchAgentCard(props: Omit<SubAgentActivityCardProps, "subAgent">) {
  return <SubAgentActivityCard subAgent="research_agent" {...props} />;
}

function WritingAgentCard(props: Omit<SubAgentActivityCardProps, "subAgent">) {
  return <SubAgentActivityCard subAgent="writing_agent" {...props} />;
}

function CritiqueAgentCard(props: Omit<SubAgentActivityCardProps, "subAgent">) {
  return <SubAgentActivityCard subAgent="critique_agent" {...props} />;
}

function Demo() {
  useComponent({
    name: "research_agent",
    render: ResearchAgentCard,
  });
  useComponent({
    name: "writing_agent",
    render: WritingAgentCard,
  });
  useComponent({
    name: "critique_agent",
    render: CritiqueAgentCard,
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Sub-Agents</h1>
      <p className="text-sm opacity-70 mb-6">
        The main agent delegates tasks to subagents via{" "}
        <code className="px-1 bg-gray-100 rounded">research_agent</code>
        {" / "}
        <code className="px-1 bg-gray-100 rounded">writing_agent</code>
        {" / "}
        <code className="px-1 bg-gray-100 rounded">critique_agent</code>. Each
        delegation runs a nested <code>chat()</code> with its own system prompt.
        Try: &ldquo;Research the benefits of remote work and draft a
        one-paragraph summary.&rdquo;
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <CopilotChat />
        <div className="h-[640px]">
          {/*
            Side-panel delegation log. The supervisor's `delegations`
            slot is not yet exposed to the frontend in built-in-agent
            (the per-call cards in chat are the primary surface), so we
            render an empty log here. The always-visible role indicator
            chips inside this component are the e2e anchor
            (`[data-testid="subagent-indicator-<role>"]`).
          */}
          <DelegationLog delegations={[]} isRunning={false} />
        </div>
      </div>
    </main>
  );
}
