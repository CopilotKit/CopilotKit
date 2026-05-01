"use client";

/**
 * Beautiful Chat — the flagship CopilotKit showcase cell, ported from the
 * canonical reference (mirrors langgraph-python and ms-agent-python).
 *
 * Runtime: this cell uses its own dedicated runtime endpoint
 * (`/api/copilotkit-beautiful-chat`) so it can enable `openGenerativeUI`,
 * `a2ui` with `injectA2UITool: false`, and `mcpApps` simultaneously — the
 * combined-runtime shape the canonical starter uses — without bleeding those
 * global flags into other cells sharing the main `/api/copilotkit` endpoint.
 *
 * Backend: the Python ADK agent is `beautiful_chat_agent`
 * (src/agents/beautiful_chat_agent.py). The agent_server.py mounts it at
 * `/beautiful_chat`; the runtime route below proxies the agent id
 * `beautiful_chat` to that path.
 */

import React from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

import { ExampleLayout } from "./components/example-layout";
import { ExampleCanvas } from "./components/example-canvas";
import { useGenerativeUIExamples, useExampleSuggestions } from "./hooks";
import { ThemeProvider } from "./hooks/use-theme";
import { demonstrationCatalog } from "./declarative-generative-ui/renderers";

export default function BeautifulChatPage() {
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl="/api/copilotkit-beautiful-chat"
        agent="beautiful_chat"
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

function HomePage() {
  useGenerativeUIExamples();
  useExampleSuggestions();

  return (
    <ExampleLayout
      chatContent={
        <CopilotChat input={{ disclaimer: () => null, className: "pb-6" }} />
      }
      appContent={<ExampleCanvas />}
    />
  );
}
