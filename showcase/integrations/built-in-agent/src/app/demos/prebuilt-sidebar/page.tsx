"use client";

import React from "react";
import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core/v2";
import { MainContent } from "./main-content";
import { Suggestions } from "./suggestions-mount";

export default function PrebuiltSidebarDemo() {
  return (
    // @region[sidebar-basic-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt-sidebar">
      <MainContent />
      {/* @region[sidebar-configuration] */}
      <CopilotSidebar agentId="prebuilt-sidebar" defaultOpen={true} />
      {/* @endregion[sidebar-configuration] */}
      <Suggestions />
    </CopilotKit>
    // @endregion[sidebar-basic-setup]
  );
}
