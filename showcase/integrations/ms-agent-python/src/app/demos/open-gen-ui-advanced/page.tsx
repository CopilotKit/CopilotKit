"use client";

/**
 * Open-Ended Generative UI — Advanced (Microsoft Agent Framework).
 * ----------------------------------------------------------------
 * The agent streams ONE `generateSandboxedUi` tool call; the runtime's
 * `OpenGenerativeUIMiddleware` (enabled by
 * `openGenerativeUI: { agents: [...] }` in
 * `api/copilotkit-ogui/route.ts`) converts that stream into
 * `open-generative-ui` activity events. Passing `openGenerativeUI` to
 * CopilotKit here activates the built-in
 * `OpenGenerativeUIActivityRenderer`, which mounts the agent-authored
 * HTML + CSS inside a sandboxed iframe.
 *
 * The distinguishing feature vs. the minimal `open-gen-ui` demo: this
 * page passes an array of `sandboxFunctions` on the provider. The
 * renderer exposes each entry as a callable method on
 * `Websandbox.connection.remote`, so the agent-authored UI can invoke
 * host-page logic from inside the sandboxed iframe.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
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
    // Pass the sandbox-function array on the `openGenerativeUI` provider prop.
    // The built-in `OpenGenerativeUIActivityRenderer` wires these as callable
    // remotes inside the agent-authored iframe.
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
