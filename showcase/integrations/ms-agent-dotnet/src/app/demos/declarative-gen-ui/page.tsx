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
 *      configured with `injectA2UITool: false` — the backend .NET agent
 *      (`agent/DeclarativeGenUiAgent.cs`) owns the `generate_a2ui` tool
 *      explicitly. The A2UI middleware still serialises the registered
 *      catalog schema into `copilotkit.context` so the secondary LLM inside
 *      `generate_a2ui` knows which components are available.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/microsoft-agent-framework/generative-ui/a2ui
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { myCatalog } from "./a2ui/catalog";

export default function DeclarativeGenUIDemo() {
  return (
    // @region[provider-a2ui-prop]
    <CopilotKit
      runtimeUrl="/api/copilotkit-declarative-gen-ui"
      agent="declarative-gen-ui"
      a2ui={{ catalog: myCatalog }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
    // @endregion[provider-a2ui-prop]
  );
}

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show a KPI dashboard",
        message:
          "Show me a quick KPI dashboard with 3-4 metrics (revenue, signups, churn).",
      },
      {
        title: "Pie chart — sales by region",
        message: "Show a pie chart of sales by region.",
      },
      {
        title: "Bar chart — quarterly revenue",
        message: "Render a bar chart of quarterly revenue.",
      },
      {
        title: "Status report",
        message:
          "Give me a status report on system health — API, database, and background workers.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
