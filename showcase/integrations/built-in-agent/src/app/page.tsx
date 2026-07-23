import Link from "next/link";

const demos = [
  { route: "/demos/agentic-chat", name: "Agentic Chat" },
  { route: "/demos/hitl", name: "In-Chat HITL" },
  { route: "/demos/tool-rendering", name: "Tool Rendering" },
  { route: "/demos/gen-ui-tool-based", name: "Tool-Based Gen UI" },
  { route: "/demos/gen-ui-agent", name: "Agentic Gen UI" },
  { route: "/demos/shared-state-read-write", name: "Shared State (R/W)" },
  { route: "/demos/shared-state-streaming", name: "State Streaming" },
  { route: "/demos/subagents", name: "Sub-Agents" },
];

export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">
        Built-in Agent (TanStack AI) — Showcase
      </h1>
      <p className="text-sm opacity-70 mb-6">
        CopilotKit&apos;s BuiltInAgent in factory mode with TanStack AI as the
        LLM backend. The agent runs in-process inside the Next.js route handler.
      </p>
      <ul className="space-y-2">
        {demos.map((d) => (
          <li key={d.route}>
            <Link className="underline" href={d.route}>
              {d.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
