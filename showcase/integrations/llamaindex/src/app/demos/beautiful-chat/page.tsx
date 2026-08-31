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
         * protocol). The canonical reference sets it to false to use the
         * v2 multi-endpoint protocol (GET /info + POST /agent/{name}/connect),
         * which requires a Hono-based endpoint via `createCopilotEndpoint`.
         * The 4085 showcase uses `copilotRuntimeNextJSAppRouterEndpoint`
         * (single-endpoint), which matches the other 4085 cells — so we
         * use its default behavior here. Functionally equivalent for this demo.
         */
      >
        <HomePage />
      </CopilotKit>
    </ThemeProvider>
  );
}
