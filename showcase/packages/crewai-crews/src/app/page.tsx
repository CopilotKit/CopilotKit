const DEMOS: Array<{ id: string; title: string; description: string }> = [
  {
    id: "agentic-chat",
    title: "Agentic Chat",
    description: "Natural conversation with frontend tool execution",
  },
  {
    id: "agentic-chat-reasoning",
    title: "Reasoning",
    description: "Visible reasoning/thinking chain alongside the answer",
  },
  {
    id: "reasoning-default-render",
    title: "Reasoning (Default Render)",
    description: "Built-in CopilotChatReasoningMessage",
  },
  {
    id: "prebuilt-sidebar",
    title: "Pre-Built: Sidebar",
    description: "Docked sidebar chat via <CopilotSidebar />",
  },
  {
    id: "prebuilt-popup",
    title: "Pre-Built: Popup",
    description: "Floating popup chat via <CopilotPopup />",
  },
  {
    id: "chat-slots",
    title: "Chat Customization (Slots)",
    description: "Customize CopilotChat via its slot system",
  },
  {
    id: "chat-customization-css",
    title: "Chat Customization (CSS)",
    description: "Default CopilotChat re-themed via CSS variables",
  },
  {
    id: "headless-simple",
    title: "Headless Chat (Simple)",
    description: "Minimal custom chat surface built on useAgent",
  },
  {
    id: "headless-complete",
    title: "Headless Chat (Complete)",
    description: "Full chat implementation built from scratch on useAgent",
  },
  {
    id: "hitl-in-chat",
    title: "In-Chat HITL",
    description: "User approves agent actions inline in chat",
  },
  {
    id: "hitl-in-app",
    title: "In-App HITL",
    description: "Approval modal pops up OUTSIDE the chat surface",
  },
  {
    id: "tool-rendering",
    title: "Tool Rendering",
    description: "Backend agent tools rendered as UI components",
  },
  {
    id: "tool-rendering-default-catchall",
    title: "Tool Rendering (Default Catch-all)",
    description: "Out-of-the-box default tool rendering",
  },
  {
    id: "tool-rendering-custom-catchall",
    title: "Tool Rendering (Custom Catch-all)",
    description: "Branded wildcard renderer",
  },
  {
    id: "tool-rendering-reasoning-chain",
    title: "Tool Rendering + Reasoning Chain",
    description: "Sequential tool calls with reasoning",
  },
  {
    id: "gen-ui-tool-based",
    title: "Tool-Based Generative UI",
    description: "Agent uses tools to trigger UI generation",
  },
  {
    id: "gen-ui-agent",
    title: "Agentic Generative UI",
    description: "Long-running agent tasks with generated UI",
  },
  {
    id: "frontend-tools",
    title: "Frontend Tools",
    description: "Agent invokes client-side handlers",
  },
  {
    id: "frontend-tools-async",
    title: "Frontend Tools (Async)",
    description: "useFrontendTool with an async handler",
  },
  {
    id: "shared-state-read-write",
    title: "Shared State (Read + Write)",
    description: "Bidirectional agent state",
  },
  {
    id: "shared-state-streaming",
    title: "State Streaming",
    description: "Per-token state delta streaming",
  },
  {
    id: "readonly-state-agent-context",
    title: "Readonly State (Agent Context)",
    description: "Read-only context via useAgentContext",
  },
  {
    id: "subagents",
    title: "Sub-Agents",
    description: "Multiple agents with visible task delegation",
  },
  {
    id: "open-gen-ui",
    title: "Open-Ended Generative UI",
    description: "Agent generates UI from an arbitrary component library",
  },
  {
    id: "open-gen-ui-advanced",
    title: "Open-Ended Gen UI (Advanced)",
    description: "Agent-authored UI that invokes host sandbox functions",
  },
  {
    id: "agent-config",
    title: "Agent Config Object",
    description: "Forward typed config object from provider to agent",
  },
];

export default function Home() {
  return (
    <main style={{ padding: "2rem", maxWidth: "1000px", margin: "0 auto" }}>
      <h1>CrewAI (Crews)</h1>
      <p>Integration ID: crewai-crews</p>
      <h2 style={{ marginTop: "2rem" }}>Demos</h2>
      <div
        style={{
          display: "grid",
          gap: "1rem",
          marginTop: "1rem",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        }}
      >
        {DEMOS.map((d) => (
          <a key={d.id} href={`/demos/${d.id}`} className="demo-card">
            <h3>{d.title}</h3>
            <p>{d.description}</p>
          </a>
        ))}
      </div>
    </main>
  );
}
