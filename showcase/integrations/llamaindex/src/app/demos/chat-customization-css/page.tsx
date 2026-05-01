"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
// @region[theme-css-import]
import "./theme.css";
// @endregion[theme-css-import]

function Chat() {
  // @region[configure-suggestions]
  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  useConfigureSuggestions({
    suggestions: [
      { title: "Theme check", message: "verify the css theme rendering" },
    ],
    available: "always",
  });
  // @endregion[configure-suggestions]

  return (
    <CopilotChat
      agentId="chat_customization_css"
      className="h-full rounded-2xl"
    />
  );
}

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
