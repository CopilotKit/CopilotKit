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
 *   3. The dedicated runtime at `/api/copilotkit-declarative-gen-ui`
 *      injects `render_a2ui`. The backend Flow forces that action while the
 *      runtime middleware supplies the registered catalog schema and turns
 *      the streamed tool call into the operations painted by the frontend.
 *      Sales data and composition rules are registered as agent context so
 *      both the Flow and A2UI renderer remain grounded in the same inputs.
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
