"use client";

import React from "react";
import {
  CopilotKitProvider,
  CopilotSidebar,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

// Outer layer — provider + main content + sidebar.
export default function PrebuiltSidebarDemo() {
  return (
    // @region[sidebar-basic-setup]
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <MainContent />
      {/* @region[sidebar-configuration] */}
      <CopilotSidebar agentId="default" defaultOpen={true} />
      {/* @endregion[sidebar-configuration] */}
      <Suggestions />
    </CopilotKitProvider>
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
        component. The sidebar is rendered alongside this main content and can
        be toggled via its launcher button. It opens by default to make the
        difference from the full-page chat demo obvious.
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
