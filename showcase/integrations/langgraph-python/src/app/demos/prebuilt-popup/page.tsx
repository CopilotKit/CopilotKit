"use client";

import React from "react";
import { CopilotKitProvider, CopilotPopup } from "@copilotkit/react-core";
import { MainContent } from "./main-content";
import { Suggestions } from "./suggestions-mount";

export default function PrebuiltPopupDemo() {
  return (
    // @region[popup-basic-setup]
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="prebuilt-popup">
      <MainContent />
      <CopilotPopup
        agentId="prebuilt-popup"
        defaultOpen={true}
        labels={{
          chatInputPlaceholder: "Ask the popup anything...",
        }}
      />
      <Suggestions />
    </CopilotKitProvider>
    // @endregion[popup-basic-setup]
  );
}
