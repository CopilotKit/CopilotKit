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
 * endpoint. The backend mount is `/beautiful-chat`, backed by a HarnessAgent
 * created in agent/BeautifulChatAgent.cs.
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
        useSingleEndpoint
        runtimeUrl="/api/copilotkit-beautiful-chat"
        agent="beautiful-chat"
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
      >
        <HomePage />
      </CopilotKit>
    </ThemeProvider>
  );
}
