"use client";

/**
 * Declarative Generative UI — A2UI Fixed Schema demo.
 *
 * In the fixed-schema flavor of A2UI, the component tree (schema) lives on
 * the frontend and the agent only streams *data* into the data model. The
 * flight card is ASSEMBLED from small sub-components in the fixed schema JSON
 * (Card > Column > [Title, Row, …]).
 *
 * - Definitions (zod schemas): `./a2ui/definitions.ts`
 * - Renderers (React): `./a2ui/renderers.tsx`
 * - Catalog wiring: `./a2ui/catalog.ts` (includes the basic catalog)
 *
 * Reference:
 * https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
 */

import React, { use } from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { fixedCatalog } from "./a2ui/catalog";

const DEMO_ID = "a2ui-fixed-schema";

export default function A2UIFixedSchemaDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    // `a2ui.catalog` wires the fixed catalog into the A2UI activity renderer.
    <CopilotKit
      runtimeUrl={`/api/${framework}/${DEMO_ID}`}
      agent={DEMO_ID}
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
    <CopilotChat agentId={DEMO_ID} className="h-full rounded-2xl" />
  );
}
