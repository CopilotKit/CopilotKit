"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { SalesDashboard } from "../components/sales-dashboard";
import { RendererSelector } from "../components/renderers/renderer-selector";
import { useRenderMode } from "../components/renderers/use-render-mode";
import { useShowcaseHooks } from "../hooks/use-showcase-hooks";
import { useShowcaseSuggestions } from "../hooks/use-showcase-suggestions";
import { ToolBasedDashboard } from "../components/renderers/tool-based";
import { A2UIDashboard } from "../components/renderers/a2ui";
import {
  HashBrownDashboard,
  useHashBrownMessageRenderer,
} from "../components/renderers/hashbrown";
const AGENT_ID = "sample_agent";

function ToolBasedPage() {
  return <ToolBasedDashboard agentId={AGENT_ID} />;
}

function A2UIPage() {
  return <A2UIDashboard agentId={AGENT_ID} />;
}

function JsonRenderPage() {
  // json-render falls back to tool-based with a note
  return (
    <div>
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm px-4 py-2 text-center">
        json-render is not yet available as a standalone starter. Showing
        tool-based rendering instead.
      </div>
      <ToolBasedDashboard agentId={AGENT_ID} />
    </div>
  );
}

function HashBrownInner() {
  const RenderMessage = useHashBrownMessageRenderer();
  useShowcaseHooks();
  useShowcaseSuggestions();

  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_ID}>
      <div className="min-h-screen w-full flex items-center justify-center">
        <SalesDashboard agentId={AGENT_ID} />
        <CopilotSidebar
          defaultOpen={true}
          labels={{ modalHeaderTitle: "Sales Dashboard Assistant" }}
          RenderMessage={RenderMessage}
        />
      </div>
    </CopilotKit>
  );
}

function HashBrownPage() {
  return (
    <HashBrownDashboard>
      <HashBrownInner />
    </HashBrownDashboard>
  );
}

export default function Home() {
  const { mode, setMode } = useRenderMode();

  const renderDashboard = () => {
    switch (mode) {
      case "tool-based":
        return <ToolBasedPage />;
      case "a2ui":
        return <A2UIPage />;
      case "json-render":
        return <JsonRenderPage />;
      case "hashbrown":
        return <HashBrownPage />;
      default:
        return <ToolBasedPage />;
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="sticky top-0 z-[60] border-b border-[var(--border)] bg-[var(--card)] px-6 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-sm font-bold text-[var(--foreground)]">
          CopilotKit Sales Dashboard
        </h1>
        <RendererSelector mode={mode} onModeChange={setMode} />
      </header>
      <main className="flex-1 overflow-hidden">{renderDashboard()}</main>
    </div>
  );
}
