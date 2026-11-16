"use client";

/**
 * Open-Ended Generative UI
 * ------------------------
 * The agent streams ONE `generateSandboxedUi` tool call. The runtime's
 * `OpenGenerativeUIMiddleware` (enabled by `openGenerativeUI: { agents: [...] }`
 * in `src/demo-runtime-options.ts`) converts that stream into
 * `open-generative-ui` activity events. Passing `openGenerativeUI` to
 * CopilotKit here activates the built-in `OpenGenerativeUIActivityRenderer`,
 * which mounts the agent-authored HTML + CSS inside a sandboxed iframe.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
 */

// @region[sandbox-function-registration]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import type { OpenGenUiAdvancedConfig } from "./config";
import { TOOL_CALL_DESIGN_SKILL } from "./design-skill";
import { openGenUiSandboxFunctions } from "./sandbox-functions";
import { openGenUiSuggestions } from "./suggestions";

export function OpenGenUiAdvancedDemo({
  config,
}: {
  config: OpenGenUiAdvancedConfig;
}) {
  // Without a design skill, the provider uses its default one.
  const designSkill = config.instructToolCall
    ? TOOL_CALL_DESIGN_SKILL
    : undefined;

  return (
    // Pass the sandbox-function array on the `openGenerativeUI` provider prop.
    // The built-in `OpenGenerativeUIActivityRenderer` wires these as callable
    // remotes inside the agent-authored iframe.
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("open-gen-ui-advanced")}
      agent="open-gen-ui-advanced"
      openGenerativeUI={{
        sandboxFunctions: openGenUiSandboxFunctions,
        designSkill,
      }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
    // @endregion[sandbox-function-registration]
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
