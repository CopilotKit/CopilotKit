"use client";

/**
 * Beautiful Chat demo — CopilotKit showcase.
 *
 * This is a port-scaffold for the verbatim beautiful-chat cell from 4084
 * (which itself ports examples/integrations/langgraph-python). The full
 * cell ships:
 *   - ExampleLayout + ExampleCanvas + mode-toggle
 *   - Todo list with HIGHLIGHT components (useComponent)
 *   - A2UI dynamic + fixed-schema catalogs
 *   - Tool rendering (get_weather + search_flights)
 *   - meeting-time-picker (useHumanInTheLoop)
 *   - Suggestions rotation
 *
 * To keep the port incremental, this scaffold renders a vanilla CopilotChat
 * against the sample_agent so the /langgraph-python/beautiful-chat route
 * exists. The rich canvas and renderers can be layered in next.
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function BeautifulChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="default">
      <div className="flex h-screen w-full items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50">
        <div className="h-full w-full max-w-5xl p-4">
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
        title: "Show me a demo",
        message: "Give me a quick tour of what you can do.",
      },
      {
        title: "Weather + flight to Tokyo",
        message: "What's the weather in Tokyo? Then find flights.",
      },
    ],
    available: "always",
  });
  return (
    <CopilotChat agentId="default" className="h-full rounded-3xl shadow-xl" />
  );
}
