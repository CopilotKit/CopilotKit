"use client";

/**
 * Open-Ended Generative UI — ADVANCED variant with host-side sandbox functions.
 *
 * Same backend wiring as `open-gen-ui` (the runtime's
 * `OpenGenerativeUIMiddleware` injects the `generateSandboxedUi` tool and
 * streams the agent's HTML/CSS/JS into a sandboxed iframe). The advanced
 * twist: the provider passes `openGenerativeUI.sandboxFunctions`, which the
 * built-in `OpenGenerativeUIActivityRenderer` exposes inside the iframe as
 * `Websandbox.connection.remote.<name>(args)`. Now the agent-authored UI
 * can call back INTO the host page — closing the loop between LLM-authored
 * UI and app-side capability.
 */

// @region[sandbox-function-registration]
import {
  CopilotKitProvider,
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
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-ogui"
      useSingleEndpoint
      openGenerativeUI={{ sandboxFunctions: openGenUiSandboxFunctions }}
    >
      <Demo />
    </CopilotKitProvider>
    // @endregion[sandbox-function-registration]
  );
}

function Demo() {
  useConfigureSuggestions({
    suggestions: openGenUiSuggestions,
    available: "always",
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">
        Open Generative UI (Advanced)
      </h1>
      <p className="text-sm opacity-70 mb-6">
        Try one of the suggestions. The agent authors HTML + JS that runs in a
        sandboxed iframe and calls host-side functions (
        <code className="mx-1 px-1 bg-gray-100 rounded">
          evaluateExpression
        </code>
        ,<code className="mx-1 px-1 bg-gray-100 rounded">notifyHost</code>) over
        a postMessage bridge.
      </p>
      <CopilotChat />
    </main>
  );
}
