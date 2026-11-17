"use client";

import React from "react";
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { MainContent } from "./main-content";
import { Suggestions } from "./suggestions-mount";

export default function PrebuiltPopupDemo() {
  return (
    // @region[popup-basic-setup]
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("prebuilt-popup")}
      agent="prebuilt-popup"
    >
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
