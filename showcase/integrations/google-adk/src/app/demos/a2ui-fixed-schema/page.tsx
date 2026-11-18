"use client";

/**
 * Declarative Generative UI — A2UI Fixed Schema demo.
 *
 * In the fixed-schema flavor of A2UI, the authored component tree is compiled
 * from Express on first use; the agent supplies flight data only. The
 * flight card is ASSEMBLED from small sub-components in
 * `src/agents/a2ui_schemas/flight_schema.json` (Card > Column > [Title, Row, …]).
 *
 * - Definitions (zod schemas): `./a2ui/definitions.ts`
 * - Renderers (React): `./a2ui/renderers.tsx`
 * - Catalog wiring: `./a2ui/catalog.ts` (extends the standard catalog)
 * - Agent: `src/agents/a2ui_fixed_agent.py` (emits an `a2ui_operations` container)
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
 */

import React from "react";
import { A2UIFormat } from "../../../../_shared/ts/a2ui-format";
import { CopilotKitProvider } from "@copilotkit/react-core";

import { catalog } from "./a2ui/catalog";
import { Chat } from "./chat";

export default function A2UIFixedSchemaDemo() {
  return (
    // `generativeUI.ui` wires the fixed catalog into the generative UI renderer.
    <A2UIFormat template>
      {(inferenceFormat) => (
        <CopilotKitProvider
          properties={{ a2ui: { inferenceFormat } }}
          runtimeUrl="/api/copilotkit-a2ui-fixed-schema"
          agentId="a2ui-fixed-schema"
          generativeUI={{ ui: catalog }}
        >
          <div className="flex justify-center items-center h-full w-full bg-neutral-50 dark:bg-background">
            <div className="h-full w-full max-w-4xl border-x border-neutral-200 bg-white dark:border-border dark:bg-background">
              <Chat />
            </div>
          </div>
        </CopilotKitProvider>
      )}
    </A2UIFormat>
  );
}
