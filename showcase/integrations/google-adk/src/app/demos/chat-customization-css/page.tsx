"use client";

// Chat Customization (CSS) — all theming lives in theme.css, scoped to the
// `.chat-css-demo-scope` wrapper. The page stays intentionally minimal;
// only <CopilotChat /> is visibly re-themed.
//
// https://docs.copilotkit.ai/custom-look-and-feel/customize-built-in-ui-components

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
// @region[theme-css-import]
import "./theme.css";
// @endregion[theme-css-import]

export default function ChatCustomizationCssDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat_customization_css">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="chat-css-demo-scope h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // Canonical e2e suggestion — exact catalog match for chat-customization-css.
  // See showcase/aimock/_canonical-catalog.json (frozen).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Theme check",
        message: "verify the css theme rendering",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="chat_customization_css"
      className="h-full rounded-2xl"
    />
  );
}
