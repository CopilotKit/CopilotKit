"use client";

import {
  CopilotChat,
  CopilotKitProvider,
  WildcardToolCallRender,
} from "@copilotkitnext/react";
import { PydanticAIAgent } from "@ag-ui/pydantic-ai";

export default function Home() {
  const agentUrl =
    typeof window === "undefined" ? "/api" : `http://localhost:8000/api`;

  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={{
        default: new PydanticAIAgent({
          url: agentUrl,
        }),
      }}
      renderToolCalls={[WildcardToolCallRender]}
    >
      <div
        style={{
          height: "100vh",
          margin: 0,
          padding: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-5">
          <h1 className="text-2xl font-light tracking-wide text-center text-zinc-900 dark:text-zinc-100">
            Pydantic AI Playground
          </h1>
        </header>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <CopilotChat />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
