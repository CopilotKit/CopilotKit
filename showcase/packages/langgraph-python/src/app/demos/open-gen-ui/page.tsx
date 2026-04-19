"use client";

/**
 * Open-Ended Generative UI — minimal setup.
 * -----------------------------------------
 * The simplest possible example. Enabling `openGenerativeUI` in the
 * runtime (see `src/app/api/copilotkit-ogui/route.ts`) is all that's
 * needed — the runtime middleware streams agent-authored HTML + CSS to
 * the built-in `OpenGenerativeUIActivityRenderer`, which mounts it
 * inside a sandboxed iframe. No custom sandbox functions, no custom
 * tools — just chat.
 *
 * Ask the agent to "Build me a simple greeting card." to see it work.
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
 */

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export default function OpenGenUiDemo() {
  // @region[minimal-provider-setup]
  // Minimal Open Generative UI frontend: the built-in activity renderer is
  // registered by CopilotKitProvider, so a plain <CopilotChat /> is enough —
  // no custom tool renderers, no activity-renderer registration.
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-ogui" agent="open-gen-ui">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl flex flex-col p-3">
          <CopilotChat agentId="open-gen-ui" className="flex-1 rounded-2xl" />
        </div>
      </div>
    </CopilotKit>
  );
  // @endregion[minimal-provider-setup]
}
