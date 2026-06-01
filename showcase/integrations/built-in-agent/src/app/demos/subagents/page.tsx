"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useComponent,
} from "@copilotkit/react-core/v2";

export default function Subagents() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useComponent({
    name: "research_agent",
    render: DelegationCard,
  });
  useComponent({
    name: "writing_agent",
    render: DelegationCard,
  });
  useComponent({
    name: "critique_agent",
    render: DelegationCard,
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Sub-Agents</h1>
      <p className="text-sm opacity-70 mb-6">
        The main agent delegates tasks to subagents via{" "}
        <code className="px-1 bg-gray-100 rounded">research_agent</code>
        {" / "}
        <code className="px-1 bg-gray-100 rounded">writing_agent</code>
        {" / "}
        <code className="px-1 bg-gray-100 rounded">critique_agent</code>. Each
        delegation runs a nested <code>chat()</code> with its own system prompt.
        Try: &ldquo;Research the benefits of remote work and draft a
        one-paragraph summary.&rdquo;
      </p>
      <CopilotChat />
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DelegationCard(props: any) {
  const { name, status, parameters, result } = props;
  const role =
    typeof name === "string"
      ? name.replace(/_agent$/, "").replace(/_/g, " ")
      : "subagent";

  let parsed: { role?: string; text?: string } = {};
  if (status === "complete" && typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      // leave parsed empty
    }
  }

  const task = parameters?.task ?? "";

  return (
    <div className="border rounded p-3 my-2 bg-blue-50">
      <div className="font-medium">
        Delegating to {role}
        {status === "complete" ? (
          <span className="opacity-60"> · done</span>
        ) : (
          <span className="opacity-60"> · running…</span>
        )}
      </div>
      {task ? (
        <div className="text-sm mt-1 opacity-80">Task: {task}</div>
      ) : null}
      {status === "complete" && parsed.text ? (
        <div className="mt-2 text-sm whitespace-pre-wrap">{parsed.text}</div>
      ) : null}
    </div>
  );
}
