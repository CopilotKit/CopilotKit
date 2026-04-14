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
      <SalesDashboard agentId="agentic_chat" />
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "Sales Dashboard Assistant",
        }}
      />
    </div>
  );
}
