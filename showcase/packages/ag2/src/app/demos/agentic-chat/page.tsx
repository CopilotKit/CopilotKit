"use client";

import React, { useEffect } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import {
  useShowcaseHooks,
  useShowcaseSuggestions,
  DemoErrorBoundary,
  SalesDashboard,
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
        onError={(error) => {
          console.error("[agentic-chat] CopilotKit error:", error);
        }}
      >
        <Chat />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function Chat() {
  useShowcaseHooks();
  useShowcaseSuggestions();

  return (
    <div className="flex h-full w-full">
      <div className="flex-1 flex justify-center items-center">
        <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
          <CopilotChat
            agentId="agentic_chat"
            className="h-full rounded-2xl max-w-6xl mx-auto"
          />
        </div>
      </div>
      <SalesDashboard />
    </div>
  );
}
