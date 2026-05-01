"use client";

// Chat Customization (CSS) — all theming lives in theme.css, scoped to the
// `.chat-css-demo-scope` wrapper. The page stays intentionally minimal;
// only <CopilotChat /> is visibly re-themed.
//
// https://docs.copilotkit.ai/custom-look-and-feel/customize-built-in-ui-components

import React from "react";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
// @region[theme-css-import]
import "./theme.css";
// @endregion[theme-css-import]

function ConfigureSuggestionsBridge() {
  // @region[canonical-e2e-suggestion]
  // Canonical e2e suggestion — single pill keyed to the aimock fixture in
  // showcase/aimock/d5-all.json (see showcase/aimock/_canonical-catalog.json).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Theme check",
        message: "verify the css theme rendering",
      },
    ],
    available: "always",
  });
  // @endregion[canonical-e2e-suggestion]
  return null;
}

export default function ChatCustomizationCssDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat-customization-css">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="chat-css-demo-scope h-full w-full max-w-4xl">
          <ConfigureSuggestionsBridge />
          <CopilotChat
            agentId="chat-customization-css"
            className="h-full rounded-2xl"
          />
        </div>
      </div>
    </CopilotKit>
  );
}
