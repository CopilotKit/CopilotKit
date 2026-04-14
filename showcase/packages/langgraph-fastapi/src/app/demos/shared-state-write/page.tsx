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

export default function SharedStateWriteDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="shared-state-write"
      a2ui={{ catalog: demonstrationCatalog }}
    >
      <div className="min-h-screen w-full flex items-center justify-center">
        <DemoContent />
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            modalHeaderTitle: "Sales Pipeline Assistant",
          }}
        />
      </div>
    </CopilotKit>
  );
}

function DemoContent() {
  useShowcaseHooks();
  useShowcaseSuggestions();

  return <SalesDashboard agentId="shared-state-write" />;
}
