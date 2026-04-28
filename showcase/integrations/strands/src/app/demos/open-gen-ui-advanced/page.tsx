"use client";

/**
 * Open-Ended Generative UI — Advanced (Strands, Wave 2).
 *
 * Adds sandbox functions that the agent-authored iframe can invoke on the
 * host page via `Websandbox.connection.remote.<name>(args)`.
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { openGenUiSandboxFunctions } from "./sandbox-functions";
import { openGenUiSuggestions } from "./suggestions";

export default function OpenGenUiAdvancedDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-ogui"
      agent="open-gen-ui-advanced"
      openGenerativeUI={{ sandboxFunctions: openGenUiSandboxFunctions }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: openGenUiSuggestions,
    available: "always",
  });

  return (
    <div className="flex h-full w-full flex-col p-3">
      <CopilotChat
        agentId="open-gen-ui-advanced"
        className="flex-1 rounded-2xl"
      />
    </div>
  );
}
