"use client";

/**
 * Declarative Generative UI (A2UI — Dynamic Schema) demo.
 *
 * Pattern:
 *   1. Define a small set of branded React components + Zod schemas in
 *      `./a2ui/definitions.ts` and `./a2ui/renderers.tsx` (the latter calls
 *      `createCatalog(..., { includeBasicCatalog: true })` and exports
 *      `myCatalog`).
 *   2. Pass that catalog to the provider via
 *      `<CopilotKit a2ui={{ catalog: myCatalog }}>`.
 *   3. The dedicated runtime at `/api/copilotkit-declarative-gen-ui` is
 *      configured with `injectA2UITool: true` — the backend agent
 *      (`src/agents/declarative_gen_ui_agent.py`) is a plain agent with no
 *      A2UI tool, and the ag-ui-adk adapter auto-injects `generate_a2ui`,
 *      mirroring the canonical langgraph-python / AWS Strands reference. The
 *      A2UI middleware still serialises the registered catalog schema into
 *      `copilotkit.context` so the secondary LLM inside `generate_a2ui`
 *      knows which components are available.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */

// @region[provider-a2ui-prop]
import React from "react";
import { A2UIFormat } from "../../../../_shared/ts/a2ui-format";
import { CopilotKit } from "@copilotkit/react-core/v2";

import { myCatalog } from "./a2ui/catalog";
import { Chat } from "./chat";

export default function DeclarativeGenUIDemo() {
  return (
    <A2UIFormat>
      {(inferenceFormat) => (
        <CopilotKit
          properties={{ a2ui: { inferenceFormat } }}
          runtimeUrl="/api/copilotkit-declarative-gen-ui"
          agent="declarative-gen-ui"
          a2ui={{ catalog: myCatalog }}
        >
          <div className="flex justify-center items-center h-full w-full">
            <div className="h-full w-full max-w-4xl">
              <Chat />
            </div>
          </div>
        </CopilotKit>
      )}
    </A2UIFormat>
    // @endregion[provider-a2ui-prop]
  );
}
