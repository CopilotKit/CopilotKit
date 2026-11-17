"use client";

/**
 * Beautiful Chat: the flagship showcase demo. Each suggestion pill shows one
 * kind of generative UI (controlled components, human in the loop, A2UI, MCP
 * Apps, Open Generative UI, frontend tools and shared state) in one chat.
 *
 * The demo's runtime, /api/<integration>/beautiful-chat, turns on Open
 * Generative UI, A2UI and MCP Apps together. This page registers the A2UI
 * catalog that the agent's surfaces render with
 * (`copilotkit://app-dashboard-catalog`) and the Open Generative UI renderer.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";

import { ThemeProvider } from "./hooks/use-theme";
import { demonstrationCatalog } from "./declarative-generative-ui/renderers";
import { HomePage } from "./home-page";

export default function BeautifulChatPage() {
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl={useDemoRuntimeUrl("beautiful-chat")}
        agent="beautiful-chat"
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
      >
        <HomePage />
      </CopilotKit>
    </ThemeProvider>
  );
}
