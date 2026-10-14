"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { Providers } from "./providers";
import type { ExampleAgent } from "./providers";

const SUGGESTED_PROMPT =
  "Build me an interactive team plan estimator with a seat slider at $29/seat, an annual-billing checkbox, a comparison table and a request-quote form.";

function Chat() {
  const searchParams = useSearchParams();
  const agent: ExampleAgent =
    searchParams.get("agent") === "langgraph" ? "langgraph" : "default";

  return (
    <Providers agent={agent}>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          maxWidth: 880,
          margin: "0 auto",
          padding: "0 16px",
        }}
      >
        <header style={{ padding: "16px 0 8px" }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>
            A2UI markdown mode (
            {agent === "langgraph" ? "LangGraph Python" : "built-in agent"})
          </h1>
          <p style={{ fontSize: 14, margin: "4px 0 0", opacity: 0.7 }}>
            Try: {SUGGESTED_PROMPT}
          </p>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          <CopilotChat />
        </div>
      </main>
    </Providers>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
