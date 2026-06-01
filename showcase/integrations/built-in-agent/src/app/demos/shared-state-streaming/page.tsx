"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

export default function SharedStateStreaming() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  // @region[frontend-use-coagent-state]
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  // @endregion[frontend-use-coagent-state]

  const document = (agent.state as { document?: string }).document ?? "";

  return (
    <main className="p-8 grid grid-cols-2 gap-8 h-screen">
      <div className="overflow-auto">
        <h1 className="text-2xl font-semibold mb-4">State Streaming</h1>
        <p className="text-sm opacity-70 mb-4">
          The agent streams the document into <code>state.document</code> by
          repeatedly calling <code>AGUISendStateDelta</code>. Try: &ldquo;Write
          a short essay about small habits, and stream the document to state as
          you go.&rdquo;
        </p>
        <pre className="whitespace-pre-wrap font-serif text-base border rounded p-4 min-h-[300px]">
          {document || (
            <span className="opacity-40 italic font-sans text-sm">
              The agent will fill this panel as it streams updates.
            </span>
          )}
        </pre>
      </div>
      <div>
        <CopilotChat />
      </div>
    </main>
  );
}
