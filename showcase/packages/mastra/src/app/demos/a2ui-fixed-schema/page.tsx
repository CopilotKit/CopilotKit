"use client";

/**
 * A2UI Fixed Schema — Mastra port.
 *
 * Fixed-schema flavor: the component tree lives on the frontend catalog,
 * and the agent streams *data* into the data model. This Mastra port
 * reuses the shared `weatherAgent` (aliased as `a2ui-fixed-schema`) so
 * the same `generate_a2ui` tool drives rendering. Because the schema is
 * frontend-owned, the agent's job is limited to filling in the bound
 * fields (origin, destination, airline, price, etc.).
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { fixedCatalog } from "./a2ui/catalog";

export default function A2UIFixedSchemaDemo() {
  return (
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
