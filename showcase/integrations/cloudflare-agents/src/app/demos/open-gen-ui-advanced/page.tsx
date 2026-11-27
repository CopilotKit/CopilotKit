"use client";

/**
 * Open-Ended Generative UI
 * ------------------------
 * The agent streams ONE `generateSandboxedUi` tool call; the runtime's
 * `OpenGenerativeUIMiddleware` (enabled by `openGenerativeUI: { agents: [...] }`
 * in `api/copilotkit-ogui/route.ts`) converts that stream into
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
import { openGenUiSandboxFunctions } from "./sandbox-functions";
import { openGenUiSuggestions } from "./suggestions";

// Imperative design skill for the advanced cell. Without a designSkill the
// provider injects DEFAULT_DESIGN_SKILL, which never tells the model to CALL
// `generateSandboxedUi`, so the shared chat agent answers in plain text (and
// sometimes claims a sandbox function "does not exist"). This makes the call
// mandatory and clarifies that sandbox functions are iframe→host bridges, not
// chat/LLM tools.
const ADVANCED_DESIGN_SKILL = `IMPERATIVE — HOW TO RESPOND: On every user turn you MUST call the \`generateSandboxedUi\` tool exactly once and render an interactive sandboxed UI. NEVER reply with plain text instead of calling the tool, and NEVER claim a tool or function "does not exist".

The sandbox functions listed in your context (e.g. evaluateExpression, notifyHost) are HOST BRIDGES, NOT chat/LLM tools. Do NOT try to call them as tools. Instead, generate HTML+JS whose code calls them from inside the iframe via \`await Websandbox.connection.remote.<functionName>(args)\` (e.g. a calculator UI whose "=" button calls \`Websandbox.connection.remote.evaluateExpression({ expression })\`). Build a clean, self-contained UI (inline SVG/HTML + CSS) that wires its controls to those bridges.`;

export default function OpenGenUiAdvancedDemo() {
  return (
    // Pass the sandbox-function array on the `openGenerativeUI` provider prop.
    // The built-in `OpenGenerativeUIActivityRenderer` wires these as callable
    // remotes inside the agent-authored iframe.
    <CopilotKit
      runtimeUrl="/api/copilotkit-ogui"
      agent="open-gen-ui-advanced"
      openGenerativeUI={{
        sandboxFunctions: openGenUiSandboxFunctions,
        designSkill: ADVANCED_DESIGN_SKILL,
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
