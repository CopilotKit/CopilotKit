"use client";

/**
 * Beautiful Chat — the flagship CopilotKit showcase cell, ported verbatim
 * from the 4084 reference clone. The 4084 version lived as its own Next.js
 * frontend at `demos/beautiful-chat/frontend/` with a full `src/components`
 * tree + A2UI catalog. Here the same tree is colocated under the cell and
 * re-wired with relative imports.
 *
 * Providers: layout-level `CopilotKit` + `ThemeProvider` wrappers from the
 * original 4084 root layout are applied here instead, because the unified
 * 4085 shell does not give each cell its own layout.tsx.
 *
 * Runtime: this cell uses its own dedicated runtime endpoint
 * (`/api/copilotkit-beautiful-chat`) so it can enable `openGenerativeUI`,
 * `a2ui` with `injectA2UITool: false`, and `mcpApps` simultaneously — the
 * same combined-runtime shape the canonical starter uses — without bleeding
 * those global flags into other cells sharing the main `/api/copilotkit`
 * endpoint. The backend graph is `beautiful_chat` (src/agents/beautiful_chat.py).
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

import { ThemeProvider } from "./hooks/use-theme";
import { demonstrationCatalog } from "./declarative-generative-ui/renderers";
import { HomePage } from "./home-page";

export default function BeautifulChatPage() {
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl="/api/copilotkit-beautiful-chat"
        agent="beautiful-chat"
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
        /*
         * `useSingleEndpoint` defaults to true (the single-POST-endpoint
         * protocol: one POST to the runtime base path carrying an RPC
         * envelope). Setting it false switches the client to REST sub-paths
         * (GET /info + POST /agent/{name}/...).
         *
         * THE SERVER MUST BE IN THE MATCHING MODE. That is selected by
         * `mode` on `createCopilotRuntimeHandler` — "single-route" serves the
         * base-path envelope, "multi-route" serves the sub-paths and 404s the
         * base path with no log line. It is NOT selected by which factory you
         * call: `createCopilotEndpoint` is a deprecated alias of
         * `createCopilotHonoHandler`, a thin wrapper that calls the same
         * handler with the same default mode.
         *
         * An earlier version of this comment claimed the multi-endpoint
         * protocol "requires a Hono-based endpoint via createCopilotEndpoint".
         * That is false, and it cost real time: it sent three separate
         * investigations of a live outage looking for a factory swap when the
         * defect was a mode mismatch.
         *
         * This integration serves the single-endpoint shape via V1
         * `copilotRuntimeNextJSAppRouterEndpoint`, matching its other cells,
         * so the client default is left alone here.
         */
      >
        <HomePage />
      </CopilotKit>
    </ThemeProvider>
  );
}
