"use client";

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import "./theme.css";

export default function ChatCustomizationCssDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="chat_customization_css">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="chat-css-demo-scope h-full w-full max-w-4xl">
          <CopilotChat
            agentId="chat_customization_css"
            className="h-full rounded-2xl"
          />
        </div>
      </div>
    </CopilotKit>
  );
}
