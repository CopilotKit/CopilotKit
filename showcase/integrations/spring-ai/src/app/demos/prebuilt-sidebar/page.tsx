"use client";

import React from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

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

function MainContent() {
  return (
    <main className="min-h-screen w-full p-12">
      <h1 className="text-3xl font-semibold mb-4">
        Sidebar demo — click the launcher
      </h1>
      <p className="text-gray-600 max-w-xl">
        This page showcases the pre-built <code>&lt;CopilotSidebar /&gt;</code>{" "}
        component wired to the Spring AI agent backend. The sidebar is rendered
        alongside this main content and can be toggled via its launcher button.
      </p>
    </main>
  );
}

function Suggestions() {
  useConfigureSuggestions({
    suggestions: [{ title: "Say hi", message: "Say hi!" }],
    available: "always",
  });
  return null;
}
