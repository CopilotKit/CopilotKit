"use client";

/**
 * Beautiful Chat — flagship CopilotKit showcase cell, ported from the
 * LangGraph reference at
 * `showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/` and
 * rewired to point at the .NET backend's `/beautiful-chat` AG-UI mount.
 *
 * Runtime: dedicated endpoint `/api/copilotkit-beautiful-chat` with
 * `openGenerativeUI: true`, `a2ui.injectA2UITool: false`, and an MCP Apps
 * configuration pointing at `https://mcp.excalidraw.com` by default.
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
        agent="beautiful-chat"
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
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
