"use client";

/**
 * Declarative Generative UI — A2UI Fixed Schema demo.
 *
 * The component tree (schema) is FIXED on the frontend: the agent cannot
 * change the layout — it only streams data into the data model. The flight
 * card is ASSEMBLED from small sub-components in
 * `backend/schemas/flight_schema.json` (Card > Column > [Title, Row, …]).
 *
 * - Definitions (zod schemas): `./a2ui/definitions.ts`
 * - Renderers (React): `./a2ui/renderers.tsx`
 * - Catalog wiring: `./a2ui/catalog.ts` (includes the basic catalog)
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { fixedCatalog } from "./a2ui/catalog";

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
