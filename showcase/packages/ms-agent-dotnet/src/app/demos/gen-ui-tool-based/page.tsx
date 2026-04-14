"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import {
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
  RendererSelector,
  useRenderMode,
  ToolBasedDashboard,
  A2UIDashboard,
  HashBrownDashboard,
  OpenGenUIDashboard,
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
    <div className="relative flex flex-col h-full w-full">
      <DashboardWithRenderer agentId="gen-ui-tool-based" />
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "Chart Generator",
        }}
      />
    </div>
  );
}

function DashboardWithRenderer({ agentId }: { agentId: string }) {
  const { mode, setMode } = useRenderMode();

  return (
    <div className="flex flex-col h-full">
      <RendererSelector mode={mode} onModeChange={setMode} />
      <div className="flex-1 flex items-center justify-center">
        {mode === "tool-based" && <ToolBasedDashboard agentId={agentId} />}
        {mode === "a2ui" && <A2UIDashboard agentId={agentId} />}
        {mode === "hashbrown" && <HashBrownDashboard />}
        {mode === "open-genui" && <OpenGenUIDashboard />}
        {mode === "json-render" && <ToolBasedDashboard agentId={agentId} />}
      </div>
    </div>
  );
}
