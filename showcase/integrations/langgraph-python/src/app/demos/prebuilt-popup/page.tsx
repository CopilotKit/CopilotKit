"use client";

import React from "react";
// @region[popup-imports]
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
// @endregion[popup-imports]
import { MainContent } from "./main-content";
import { Suggestions } from "./suggestions-mount";

export default function PrebuiltPopupDemo() {
  return (
    // @region[popup-basic-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt-popup">
      <MainContent />
      <CopilotPopup
        agentId="prebuilt-popup"
        defaultOpen={true}
        labels={{
          chatInputPlaceholder: "Ask the popup anything...",
        }}
      />
      <Suggestions />
    </CopilotKit>
    // @endregion[popup-basic-setup]
  );
}
