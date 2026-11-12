"use client";

/**
 * Declarative Generative UI (A2UI — Dynamic Schema) demo.
 *
 * Pattern:
 *   1. Define a small set of branded React components + Zod schemas in
 *      `./a2ui/definitions.ts` and `./a2ui/renderers.tsx`. `./a2ui/catalog.ts`
 *      joins them with `createGenerativeUI({ extends: [standardUI] })` and
 *      exports `myCatalog`.
 *   2. Pass that catalog to the provider via
 *      `<CopilotKitProvider generativeUI={{ ui: myCatalog }}>`.
 *   3. The dedicated runtime at `/api/copilotkit-declarative-gen-ui` is
 *      configured with `injectA2UITool: false` — the backend agent
 *      (`src/agents/a2ui_dynamic.py`) owns the `generate_a2ui` tool
 *      explicitly, mirroring the working pattern from beautiful-chat and the
 *      canonical `examples/starters/langgraph-python` reference. The
 *      A2UI middleware still serialises the registered catalog schema into
 *      `copilotkit.context` so the secondary LLM inside `generate_a2ui`
 *      knows which components are available.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */

// @region[provider-a2ui-prop]
import React from "react";
import { CopilotKitProvider } from "@copilotkit/react-core";

import { myCatalog } from "./a2ui/catalog";
import { Chat } from "./chat";

export default function DeclarativeGenUIDemo() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-declarative-gen-ui"
      agentId="declarative-gen-ui"
      generativeUI={{ ui: myCatalog }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKitProvider>
    // @endregion[provider-a2ui-prop]
  );
}
