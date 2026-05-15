interface DemoLink {
  id: string;
  href: string;
  title: string;
  description: string;
}

const DEMOS: DemoLink[] = [
  {
    id: "agentic-chat",
    href: "/demos/agentic-chat",
    title: "Agentic Chat",
    description: "Natural conversation with frontend tool execution",
  },
  {
    id: "hitl",
    href: "/demos/hitl",
    title: "Human in the Loop (original)",
    description: "User approves agent actions before execution",
  },
  {
    id: "hitl-in-chat",
    href: "/demos/hitl-in-chat",
    title: "HITL In-Chat (useHumanInTheLoop)",
    description: "Inline chat approval via the ergonomic hook",
  },
  {
    id: "hitl-in-app",
    href: "/demos/hitl-in-app",
    title: "HITL In-App",
    description: "App-level modal approval via async frontend tool",
  },
  {
    id: "tool-rendering",
    href: "/demos/tool-rendering",
    title: "Tool Rendering",
    description: "Backend agent tools rendered as UI components",
  },
  {
    id: "tool-rendering-default-catchall",
    href: "/demos/tool-rendering-default-catchall",
    title: "Tool Rendering (Default Catch-all)",
    description: "Built-in default tool-call card",
  },
  {
    id: "tool-rendering-custom-catchall",
    href: "/demos/tool-rendering-custom-catchall",
    title: "Tool Rendering (Custom Catch-all)",
    description: "Single branded wildcard renderer",
  },
  {
    id: "gen-ui-tool-based",
    href: "/demos/gen-ui-tool-based",
    title: "Tool-Based Generative UI",
    description: "Agent uses tools to trigger UI generation",
  },
  {
    id: "gen-ui-agent",
    href: "/demos/gen-ui-agent",
    title: "Agentic Generative UI",
    description: "Long-running agent tasks with generated UI",
  },
  {
    id: "shared-state-read-write",
    href: "/demos/shared-state-read-write",
    title: "Shared State (Read + Write)",
    description: "Bidirectional agent state",
  },
  {
    id: "shared-state-streaming",
    href: "/demos/shared-state-streaming",
    title: "State Streaming",
    description: "Per-token state delta streaming",
  },
  {
    id: "readonly-state-agent-context",
    href: "/demos/readonly-state-agent-context",
    title: "Readonly State (Agent Context)",
    description: "Read-only context via useAgentContext",
  },
  {
    id: "subagents",
    href: "/demos/subagents",
    title: "Sub-Agents",
    description: "Multiple agents with visible task delegation",
  },
  {
    id: "prebuilt-sidebar",
    href: "/demos/prebuilt-sidebar",
    title: "Pre-Built Sidebar",
    description: "Docked <CopilotSidebar />",
  },
  {
    id: "prebuilt-popup",
    href: "/demos/prebuilt-popup",
    title: "Pre-Built Popup",
    description: "Floating <CopilotPopup />",
  },
  {
    id: "chat-slots",
    href: "/demos/chat-slots",
    title: "Chat Slots",
    description: "Customize CopilotChat via slot system",
  },
  {
    id: "chat-customization-css",
    href: "/demos/chat-customization-css",
    title: "Chat Customization (CSS)",
    description: "Theming via CopilotKitCSSProperties",
  },
  {
    id: "headless-simple",
    href: "/demos/headless-simple",
    title: "Headless Chat (Simple)",
    description: "Minimal custom chat surface on useAgent",
  },
  {
    id: "frontend-tools",
    href: "/demos/frontend-tools",
    title: "Frontend Tools",
    description: "Client-side handlers via useFrontendTool",
  },
  {
    id: "frontend-tools-async",
    href: "/demos/frontend-tools-async",
    title: "Frontend Tools (Async)",
    description: "Async handler + render output",
  },
  {
    id: "agentic-chat-reasoning",
    href: "/demos/agentic-chat-reasoning",
    title: "Reasoning",
    description: "Visible reasoning chain via slot override",
  },
  {
    id: "reasoning-default-render",
    href: "/demos/reasoning-default-render",
    title: "Reasoning (Default Render)",
    description: "Built-in CopilotChatReasoningMessage",
  },
  {
    id: "agent-config",
    href: "/demos/agent-config",
    title: "Agent Config",
    description: "Forward config (tone/expertise/length) via context",
  },
];

export default function Home() {
  return (
    <main style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      <h1>Mastra</h1>
      <p>Integration ID: mastra</p>
      <h2 style={{ marginTop: "2rem" }}>Demos</h2>
      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        {DEMOS.map((d) => (
          <a key={d.id} href={d.href} className="demo-card">
            <h3>{d.title}</h3>
            <p>{d.description}</p>
          </a>
        ))}
      </div>
    </main>
  );
}
