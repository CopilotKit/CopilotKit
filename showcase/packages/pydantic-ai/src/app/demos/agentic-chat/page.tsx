"use client";

import React, { useEffect } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import {
  DemoErrorBoundary,
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
  useEffect(() => {
    console.log("[agentic-chat] Demo mounted");
  }, []);

  return (
    <DemoErrorBoundary demoName="Agentic Chat">
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="agentic_chat"
        a2ui={{ catalog: demonstrationCatalog }}
        onError={(error) => {
          console.error("[agentic-chat] CopilotKit error:", error);
        }}
      >
        <DemoContent />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function DemoContent() {
  useShowcaseHooks();
  useShowcaseSuggestions();

  return (
    <div className="min-h-screen w-full flex items-center justify-center">
      <DashboardWithRenderer agentId="agentic_chat" />
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "Sales Dashboard Assistant",
        }}
      />
    </div>
  );
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
