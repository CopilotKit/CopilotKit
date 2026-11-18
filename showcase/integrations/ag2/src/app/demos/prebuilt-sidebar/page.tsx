"use client";

import React from "react";
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core";
import { MainContent } from "./main-content";
import { Suggestions } from "./suggestions-mount";

export default function PrebuiltSidebarDemo() {
  return (
    // @region[sidebar-basic-setup]
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="prebuilt-sidebar">
      <MainContent />
      {/* @region[sidebar-configuration] */}
      <CopilotSidebar agentId="prebuilt-sidebar" defaultOpen={true} />
      {/* @endregion[sidebar-configuration] */}
      <Suggestions />
    </CopilotKitProvider>
    // @endregion[sidebar-basic-setup]
  );
}
