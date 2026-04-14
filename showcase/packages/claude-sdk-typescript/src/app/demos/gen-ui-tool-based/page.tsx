"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import {
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
} from "@copilotkit/showcase-shared";

export default function GenUiToolBasedDemo() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent="gen-ui-tool-based"
        a2ui={{ catalog: demonstrationCatalog }}
      >
        <SidebarWithContent />
      </CopilotKit>
    </div>
  );
}

function SidebarWithContent() {
  useShowcaseHooks();
  useShowcaseSuggestions();

  return (
    <div className="relative flex items-center justify-center h-full w-full">
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "Chart Generator",
        }}
      />
      <div style={{ padding: "48px 80px", width: "100%", maxWidth: "56rem" }}>
        <div className="text-center text-gray-400 text-lg">
          Use the sidebar to generate charts. Try "Show me a pie chart of
          revenue by category" or "Show me a bar chart of expenses."
        </div>
      </div>
    </div>
  );
}
