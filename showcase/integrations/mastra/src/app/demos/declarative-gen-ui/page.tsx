"use client";

/**
 * Declarative Generative UI (A2UI — Dynamic Schema) — Mastra port.
 *
 * The Mastra port reuses the shared `weatherAgent` (aliased as
 * `declarative-gen-ui` in the demo-alias list in
 * `src/app/api/copilotkit/route.ts`). The `generate_a2ui` tool on the
 * agent drives dynamic A2UI rendering; the frontend supplies the catalog
 * via `<CopilotKit a2ui={{ catalog: myCatalog }}>` and the
 * `@copilotkit/a2ui-renderer` intercepts operations from the tool output.
 *
 * NOTE: The Mastra `generate-a2ui` tool does its own internal LLM pass
 * inside `generateA2uiImpl` + `buildA2uiOperationsFromToolCall` (see
 * `src/mastra/tools/index.ts`); there's no route-level A2UI middleware
 * like LangGraph. The dynamic-schema catalog still ships because the
 * serialized definitions travel through the tool's system prompt.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { myCatalog } from "./a2ui/catalog";

export default function DeclarativeGenUIDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="declarative-gen-ui"
      a2ui={{ catalog: myCatalog }}
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
