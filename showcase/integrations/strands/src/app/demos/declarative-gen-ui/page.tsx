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
 *      configured with `injectA2UITool: true` + `defaultCatalogId:
 *      "declarative-gen-ui-catalog"`. The runtime injects a `generate_a2ui`
 *      tool and drives a secondary render planner to GENERATE the surface;
 *      the Strands adapter auto-injects the tool on the backend side when it
 *      sees the forwarded flag (the dedicated backend agent wires no tool
 *      itself). The A2UI middleware serialises the registered catalog schema
 *      so the planner knows which components are available. Mirrors the
 *      canonical `examples/starters/langgraph-python` reference.
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
