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
 *      configured with `injectA2UITool: false` — the backend agent
 *      (`src/agents/a2ui_dynamic.py`) owns the `generate_a2ui` tool
 *      explicitly, mirroring the working pattern from beautiful-chat and the
 *      canonical `examples/integrations/langgraph-python` reference. The
 *      A2UI middleware still serialises the registered catalog schema into
 *      `copilotkit.context` so the secondary LLM inside `generate_a2ui`
 *      knows which components are available.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

import { myCatalog } from "./a2ui/catalog";
import { Chat } from "./chat";

export default function DeclarativeGenUIDemo() {
  return (
    // @region[provider-a2ui-prop]
    <CopilotKit
      runtimeUrl="/api/copilotkit-declarative-gen-ui"
      agent="declarative-gen-ui"
      a2ui={{ catalog: myCatalog }}
    >
      <div className="declarative-gen-ui-wide flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-6xl">
          <Chat />
        </div>
        {/*
          The chat surface caps its internal scroll column and input row at
          `cpk:max-w-3xl` (~768px). For this demo we want the generated A2UI
          cards (KPI dashboards, charts, status reports) to breathe wider, so
          we widen those wrappers locally to ~64rem. Attribute selector avoids
          escaping the `:` in the Tailwind class name.
        */}
        <style>{`
          .declarative-gen-ui-wide [class~="cpk:max-w-3xl"] {
            max-width: 64rem;
          }
        `}</style>
      </div>
    </CopilotKit>
    // @endregion[provider-a2ui-prop]
  );
}
