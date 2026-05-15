"use client";

// Chat Customization (CSS) — all theming lives in theme.css, scoped to the
// `.chat-css-demo-scope` wrapper. The page stays intentionally minimal;
// only <CopilotChat /> is visibly re-themed.

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";
// @region[theme-css-import]
import "./theme.css";
// @endregion[theme-css-import]

export default function ChatCustomizationCssDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat-customization-css">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="chat-css-demo-scope h-full w-full max-w-4xl">
          <CopilotChat
            agentId="chat-customization-css"
            className="h-full rounded-2xl"
          />
        </div>
      </div>
    </CopilotKit>
  );
}
