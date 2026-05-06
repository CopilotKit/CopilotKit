"use client";

import React, { use } from "react";
import {
  CopilotKit,
  CopilotPopup,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

const DEMO_ID = "prebuilt-popup";

// Outer layer — provider + main content + floating popup launcher.
export default function PrebuiltPopupDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    // @region[popup-basic-setup]
    <CopilotKit runtimeUrl={`/api/${framework}/${DEMO_ID}`} agent={DEMO_ID}>
      <MainContent />
      <CopilotPopup
        agentId={DEMO_ID}
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
        component. A floating launcher bubble sits in the corner, opening an
        overlay chat window on top of the page content. It starts open by
        default to make the popup form factor obvious.
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
