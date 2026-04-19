"use client";

/**
 * Declarative Generative UI (A2UI) — canonical Bring-Your-Own-Catalog demo.
 *
 * Pattern (straight from the docs):
 *   1. Define a small set of branded React components + Zod schemas in
 *      `./a2ui/definitions.ts` and `./a2ui/renderers.tsx` (the latter calls
 *      `createCatalog(..., { includeBasicCatalog: true })` and exports
 *      `myCatalog`).
 *   2. Pass that catalog to the provider via
 *      `<CopilotKit a2ui={{ catalog: myCatalog }}>`.
 *   3. Configure the runtime with
 *      `a2ui: { injectA2UITool: true, agents: [...] }` in
 *      `./api/copilotkit/route.ts`. The runtime auto-injects the
 *      `render_a2ui` tool + the catalog schema into the agent's context.
 *   4. The backend agent (`backend/agent.py`) is just a plain
 *      `create_agent` with `CopilotKitMiddleware` and `tools=[]` — no
 *      secondary LLM, no hand-written `render_a2ui` tool.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { myCatalog } from "./a2ui/renderers";

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
        title: "Status report",
        message:
          "Give me a status report on system health — API, database, and background workers.",
      },
      {
        title: "Service summary card",
        message:
          "Summarise our checkout service: owner, region, uptime, and a 'View runbook' button.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
