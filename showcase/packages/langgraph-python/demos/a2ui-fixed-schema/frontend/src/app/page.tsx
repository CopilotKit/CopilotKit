"use client";

/**
 * Declarative Generative UI — A2UI Fixed Schema demo.
 *
 * In the fixed-schema flavor of A2UI, the component tree (schema) lives on
 * the frontend and the agent only streams *data* into the data model. Here
 * the fixed shape is a flight card: { origin, destination, airline, price }.
 *
 * - Catalog + Zod schema: `./catalog.ts`
 * - The single React component: `./flight-card.tsx`
 * - Agent: `backend/agent.py` (emits an `a2ui_operations` container)
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { fixedCatalog } from "./catalog";

export default function A2UIFixedSchemaDemo() {
  return (
    // `a2ui.catalog` wires the fixed catalog into the A2UI activity renderer.
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="a2ui-fixed-schema"
      a2ui={{ catalog: fixedCatalog }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Find SFO → JFK",
        message: "Find me a flight from SFO to JFK on United for $289.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat agentId="a2ui-fixed-schema" className="h-full rounded-2xl" />
  );
}
