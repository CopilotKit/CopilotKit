"use client";

import React from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function PrebuiltSidebarDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt_sidebar">
      <MainContent />
      <CopilotSidebar agentId="prebuilt_sidebar" defaultOpen={true} />
      <Suggestions />
    </CopilotKit>
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
  useConfigureSuggestions({
    suggestions: [{ title: "Say hi", message: "Say hi!" }],
    available: "always",
  });
  return null;
}
