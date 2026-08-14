"use client";

/**
 * Declarative Generative UI — A2UI Fixed Schema demo.
 *
 * In the fixed-schema flavor of A2UI, the component tree (schema) lives on
 * the frontend and the agent only streams *data* into the data model. The
 * flight card is ASSEMBLED from small sub-components in
 * `src/agents/a2ui_schemas/flight_schema.json` (Card > Column > [Title, Row, …]).
 *
 * - Definitions (zod schemas): `./a2ui/definitions.ts`
 * - Renderers (React): `./a2ui/renderers.tsx`
 * - Catalog wiring: `./a2ui/catalog.ts` (includes the basic catalog)
 * - Agent: `src/agents/a2ui_fixed.py` (emits an `a2ui_operations` container)
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

import { catalog } from "./a2ui/catalog";
import { Chat } from "./chat";

export default function A2UIFixedSchemaDemo() {
  return (
    // `a2ui.catalog` wires the fixed catalog into the A2UI activity renderer.
    <CopilotKit
      runtimeUrl="/api/copilotkit-a2ui-fixed-schema"
      agent="a2ui-fixed-schema"
      a2ui={{ catalog: catalog }}
    >
      <div className="flex justify-center items-center h-screen w-full bg-neutral-50">
        <div className="h-full w-full max-w-4xl border-x border-neutral-200 bg-white">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}
