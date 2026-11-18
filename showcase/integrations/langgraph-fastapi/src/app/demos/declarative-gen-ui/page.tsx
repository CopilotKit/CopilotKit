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
 *   3. The provider points at the dedicated runtime at
 *      `/api/copilotkit-declarative-gen-ui`, which renders the A2UI surfaces
 *      the `declarative-gen-ui` agent produces.
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
