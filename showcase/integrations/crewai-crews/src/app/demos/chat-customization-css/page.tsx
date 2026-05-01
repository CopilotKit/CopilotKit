"use client";

// Chat Customization (CSS) — all theming lives in theme.css, scoped to the
// `.chat-css-demo-scope` wrapper.

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
// @region[theme-css-import]
import "./theme.css";
// @endregion[theme-css-import]

function CanonicalSuggestion() {
  // @canonical: pill exercises catalog message — see showcase/aimock/_canonical-catalog.json
  // Single-click prompt matches the aimock fixture in
  // showcase/aimock/d5-all.json so the local stack renders deterministically.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Theme check",
        message: "verify the css theme rendering",
      },
    ],
    available: "always",
  });
  return null;
}

export default function ChatCustomizationCssDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat-customization-css">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="chat-css-demo-scope h-full w-full max-w-4xl">
          <CanonicalSuggestion />
          <CopilotChat
            agentId="chat-customization-css"
            className="h-full rounded-2xl"
          />
        </div>
      </div>
    </CopilotKit>
  );
}
