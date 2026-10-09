"use client";

import { useParams } from "next/navigation";
import React from "react";
import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core/v2";
import { MainContent } from "./main-content";
import { Suggestions } from "./suggestions-mount";

export default function PrebuiltSidebarDemo() {
  const { integration } = useParams<{ integration: string }>();
  return (
    // @region[sidebar-basic-setup]
    <CopilotKit
      runtimeUrl={`/api/${integration}/prebuilt-sidebar`}
      agent="prebuilt-sidebar"
    >
      <MainContent />
      {/* @region[sidebar-configuration] */}
      <CopilotSidebar agentId="prebuilt-sidebar" defaultOpen={true} />
      {/* @endregion[sidebar-configuration] */}
      <Suggestions />
    </CopilotKit>
    // @endregion[sidebar-basic-setup]
  );
}
