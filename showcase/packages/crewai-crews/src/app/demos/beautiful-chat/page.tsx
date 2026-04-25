"use client";

/**
 * Beautiful Chat - the flagship CopilotKit showcase cell, ported from the
 * LangGraph-Python reference. The frontend tree (ExampleLayout,
 * ExampleCanvas, declarative-generative-ui catalog, hooks, ui kit) is
 * copied over verbatim; only the runtime wiring and the suggestion pills
 * are CrewAI-specific.
 *
 * Deviations from the LangGraph reference:
 * - No `mcpApps` on the runtime. `ag-ui-crewai` does not expose an MCP
 *   multiplexer and CrewAI crews use Pydantic BaseTool lists. The
 *   "Excalidraw Diagram (MCP App)" suggestion pill is removed in
 *   `hooks/use-example-suggestions.tsx`.
 * - Backend is a dedicated CrewAI crew (`src/agents/beautiful_chat.py`)
 *   mounted at `/beautiful-chat` on the FastAPI agent server.
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
    <div data-testid="beautiful-chat-root" className="h-screen">
      <ExampleLayout
        chatContent={
          <CopilotChat input={{ disclaimer: () => null, className: "pb-6" }} />
        }
        appContent={<ExampleCanvas />}
      />
    </div>
  );
}
