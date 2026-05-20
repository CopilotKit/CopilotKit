"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

type Step = {
  title: string;
  status?: "pending" | "in_progress" | "done";
};

export default function GenUiAgent() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  const steps = (agent.state as { steps?: Step[] }).steps ?? [];

  return (
    <main className="p-8 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-8">
      <div>
        <h1 className="text-2xl font-semibold mb-4">Agentic Generative UI</h1>
        <p className="text-sm opacity-70 mb-4">
          The agent emits a live plan via <code>AGUISendStateDelta</code> (
          <code>{`{ op: "replace", path: "/steps", value: [...] }`}</code>
          ). Each tick re-renders the panel below. Try: &ldquo;Plan a 4-step
          morning routine and execute it; emit the plan to state.&rdquo;
        </p>
        <StepsPanel steps={steps} />
      </div>
      <div>
        <CopilotChat />
      </div>
    </main>
  );
}

function StepsPanel({ steps }: { steps: Step[] }) {
  if (!steps.length) {
    return (
      <div className="border rounded p-3 text-sm opacity-40 italic">
        No plan yet. The agent will fill this panel as it works.
      </div>
    );
  }
  return (
    <div className="border rounded p-3">
      <div className="font-medium mb-2">Plan</div>
      <ol className="space-y-1 text-sm">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-4">
              {s.status === "done"
                ? "✓"
                : s.status === "in_progress"
                  ? "•"
                  : "○"}
            </span>
            <span
              className={
                s.status === "done" ? "line-through opacity-60" : undefined
              }
            >
              {s.title}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
