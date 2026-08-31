"use client";

// Chat Customization (CSS) — every visual choice in this demo lives in
// theme.css and is scoped to the `.chat-css-demo-scope` wrapper. The page
// intentionally stays minimal so the contrast against the default look
// comes entirely from the stylesheet.
//
// https://docs.copilotkit.ai/custom-look-and-feel/customize-built-in-ui-components

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
// @region[theme-css-import]
import "./theme.css";
// @endregion[theme-css-import]

export default function ChatCustomizationCssDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat-customization-css">
      <div className="flex justify-center items-center h-screen w-full bg-white p-6">
        <div className="chat-css-demo-scope h-full w-full max-w-4xl">
          <CopilotChat
            agentId="chat-customization-css"
            className="h-full"
            attachments={{ enabled: true }}
          />
        </div>
      </div>
    </CopilotKit>
  );
}
