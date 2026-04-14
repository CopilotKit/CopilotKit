"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import {
  SalesDashboard,
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
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

  return <SalesDashboard agentId="agentic_chat" />;
}
