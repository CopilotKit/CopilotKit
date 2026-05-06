"use client";

/**
 * Open Generative UI (Advanced) demo — unified nextjs shell.
 *
 * Extends the minimal Open Generative UI demo by registering host-side
 * sandbox functions the agent-authored iframe can invoke via
 * `Websandbox.connection.remote.<name>(args)`. The built-in
 * `OpenGenerativeUIActivityRenderer` wires these as callable remotes.
 *
 * The `openGenerativeUI.agents` runtime flag is set in the dedicated API
 * route. This page only passes the sandbox functions to the provider.
 */

import React, { use } from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { openGenUiSandboxFunctions } from "./sandbox-functions";

const DEMO_ID = "open-gen-ui-advanced";

const advancedSuggestions = [
  {
    title: "Calculator (calls evaluateExpression)",
    message:
      "Build a modern calculator UI. Do NOT use a <form> element or type='submit' buttons " +
      "(the sandbox blocks form submissions). Use <button type='button'> with click handlers. " +
      "When the user presses '=', the handler MUST `await " +
      "Websandbox.connection.remote.evaluateExpression({ expression })` with the current " +
      "display expression, then read `res.value` (when `res.ok` is true) and update the display " +
      "to that number.",
  },
  {
    title: "Ping the host (calls notifyHost)",
    message:
      "Build a simple card with a single 'Say hi to the host' button (type='button', NO <form>). " +
      "When clicked, the handler MUST `await " +
      "Websandbox.connection.remote.notifyHost({ message: 'Hi from the sandbox!' })` and then " +
      "display the returned confirmation object inside the card.",
  },
  {
    title: "Inline expression evaluator",
    message:
      "Build a tiny UI with a text input and an 'Evaluate' button. IMPORTANT: do NOT wrap them in a " +
      "<form>, and do NOT use type='submit'. Use <button type='button'> wired with " +
      "addEventListener('click', ...). When clicked, read the input value, call `const res = await " +
      "Websandbox.connection.remote.evaluateExpression({ expression })`, and then render " +
      "`res.value` (if `res.ok === true`) or `res.error` (if `res.ok === false`) below the input.",
  },
];

export default function OpenGenUiAdvancedDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    // @region[sandbox-function-registration]
    // Pass the sandbox-function array on the `openGenerativeUI` provider prop.
    // The built-in `OpenGenerativeUIActivityRenderer` wires these as callable
    // remotes inside the agent-authored iframe.
    <CopilotKit
      runtimeUrl={`/api/${framework}/${DEMO_ID}`}
      agent={DEMO_ID}
      openGenerativeUI={{ sandboxFunctions: openGenUiSandboxFunctions }}
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
    suggestions: advancedSuggestions,
    available: "always",
  });

  return (
    <div className="flex h-full w-full flex-col p-3">
      <CopilotChat agentId={DEMO_ID} className="flex-1 rounded-2xl" />
    </div>
  );
}
