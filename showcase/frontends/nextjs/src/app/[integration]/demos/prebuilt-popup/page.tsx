"use client";

import { useParams } from "next/navigation";
import React from "react";
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
import { MainContent } from "./main-content";
import { Suggestions } from "./suggestions-mount";

export default function PrebuiltPopupDemo() {
  const { integration } = useParams<{ integration: string }>();
  return (
    // @region[popup-basic-setup]
    <CopilotKit
      runtimeUrl={`/api/${integration}/prebuilt-popup`}
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
