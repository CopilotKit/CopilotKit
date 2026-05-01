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
    <CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt_sidebar">
      <MainContent />
      {/* @region[sidebar-configuration] */}
      <CopilotSidebar agentId="prebuilt_sidebar" defaultOpen={true} />
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
        component against the LlamaIndex agent backend.
      </p>
    </main>
  );
}

function Suggestions() {
  // @region[configure-suggestions]
  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  useConfigureSuggestions({
    suggestions: [
      { title: "Say hi", message: "Say hi!" },
      { title: "Sidebar hello", message: "hi from the sidebar test" },
    ],
    available: "always",
  });
  // @endregion[configure-suggestions]
  return null;
}
