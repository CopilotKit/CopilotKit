"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotPopup,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function PrebuiltPopupDemo() {
  return (
    // @region[popup-basic-setup]
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
    // @endregion[popup-basic-setup]
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
        component wired to a Mastra-backed agent. A floating launcher bubble
        sits in the corner, opening an overlay chat window on top of the page
        content. It starts open by default to make the popup form factor
        obvious.
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
