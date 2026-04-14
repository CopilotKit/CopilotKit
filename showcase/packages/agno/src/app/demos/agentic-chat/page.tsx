"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import {
  SalesDashboard,
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
  RendererSelector,
  useRenderMode,
  ToolBasedDashboard,
  A2UIDashboard,
  HashBrownDashboard,
  OpenGenUIDashboard,
} from "@copilotkit/showcase-shared";

export default function AgenticChatDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="agentic_chat"
      a2ui={{ catalog: demonstrationCatalog }}
    >
      <div className="min-h-screen w-full flex items-center justify-center">
        <DemoContent />
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            modalHeaderTitle: "Sales Assistant",
          }}
        />
      </div>
    </CopilotKit>
  );
}

function DemoContent() {
  useShowcaseHooks();
  useShowcaseSuggestions();

  return <DashboardWithRenderer agentId="agentic_chat" />;
}

function DashboardWithRenderer({ agentId }: { agentId: string }) {
  const { mode, setMode } = useRenderMode();

  return (
    <div className="flex flex-col h-full">
      <RendererSelector mode={mode} onModeChange={setMode} />
      <div className="flex-1">
        {mode === "tool-based" && <ToolBasedDashboard agentId={agentId} />}
        {mode === "a2ui" && <A2UIDashboard agentId={agentId} />}
        {mode === "hashbrown" && <HashBrownDashboard />}
        {mode === "open-genui" && <OpenGenUIDashboard />}
        {mode === "json-render" && <ToolBasedDashboard agentId={agentId} />}
      </div>
    </div>
  );
}
