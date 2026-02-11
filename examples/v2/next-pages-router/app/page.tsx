"use client";

import { CopilotKitProvider, CopilotSidebar } from "@copilotkitnext/react";

const runtimeUrl =
  process.env.NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL ??
  "http://localhost:4000/api/copilotkit";

export default function Home() {
  return (
    <CopilotKitProvider runtimeUrl={runtimeUrl} useSingleEndpoint>
      <div className="page">
        <main className="content">
          <h1>CopilotKit v2 + Express (Single Route)</h1>
          <p>
            This client connects to the Express runtime at
            <code className="inline-code">{runtimeUrl}</code>.
          </p>
          <p>
            Try asking it to "roast my name" to trigger the server-side tool.
          </p>
        </main>
        <CopilotSidebar
          defaultOpen
          width="420px"
          labels={{
            modalHeaderTitle: "CopilotKit",
            chatInputPlaceholder: "Ask CopilotKit anything...",
          }}
        />
      </div>
    </CopilotKitProvider>
  );
}
