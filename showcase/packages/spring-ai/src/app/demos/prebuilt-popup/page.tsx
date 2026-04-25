"use client";

import React from "react";
import {
  CopilotKit,
  CopilotPopup,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function PrebuiltPopupDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt-popup">
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
  );
}

function MainContent() {
  return (
    <main className="min-h-screen w-full p-12">
      <h1 className="text-3xl font-semibold mb-4">
        Popup demo — look for the floating launcher
      </h1>
      <p className="text-gray-600 max-w-xl">
        This page showcases the pre-built <code>&lt;CopilotPopup /&gt;</code>{" "}
        component wired to the Spring AI agent backend. A floating launcher sits
        in the corner and opens an overlay chat window on top of the page.
      </p>
    </main>
  );
}

function Suggestions() {
  useConfigureSuggestions({
    suggestions: [{ title: "Say hi", message: "Say hi from the popup!" }],
    available: "always",
  });
  return null;
}
