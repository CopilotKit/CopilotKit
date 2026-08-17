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
 * `a2ui` with `injectA2UITool: true`, and `mcpApps` simultaneously — the
 * same combined-runtime shape the canonical starter uses — without bleeding
 * those global flags into other cells sharing the main `/api/copilotkit`
 * endpoint. The backend graph is `beautiful_chat` (src/agents/beautiful_chat.py).
 */

import { useParams } from "next/navigation";
import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

import { ThemeProvider } from "./hooks/use-theme";
import { demonstrationCatalog } from "./declarative-generative-ui/renderers";
import { HomePage } from "./home-page";

export default function BeautifulChatPage() {
  const { integration } = useParams<{ integration: string }>();
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl={`/api/${integration}/beautiful-chat`}
        agent="beautiful-chat"
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
        /*
         * `useSingleEndpoint` is left unset, so it defaults to TRUE and this
         * page speaks the single-POST-endpoint protocol, like every other
         * demo page here except `auth` and `voice`. Its route must therefore
         * be mounted with `mode: "single-route"`, which is what the generic
         * `[demo]` route passes.
         *
         * The default is true because `CopilotKit` imported from
         * `@copilotkit/react-core/v2` is the V1 COMPATIBILITY WRAPPER, not the
         * V2 provider — it applies `useSingleEndpoint={props.useSingleEndpoint
         * ?? true}`. (The V2 provider is `CopilotKitProvider`, which defaults
         * to auto-detect instead.)
         *
         * An earlier version of this comment said the multi-endpoint protocol
         * "requires a Hono-based endpoint via createCopilotEndpoint". That is
         * FALSE and cost a debugging detour: `createCopilotEndpoint` just wraps
         * `createCopilotRuntimeHandler` and forwards the same `mode`, so the
         * protocol is chosen by `mode` alone and Hono has nothing to do with
         * it.
         */
      >
        <HomePage />
      </CopilotKit>
    </ThemeProvider>
  );
}
