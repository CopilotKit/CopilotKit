// Dev-navigation landing page for the MS Agent Harness (.NET) column.
//
// This is a static index used when browsing the integration directly during
// development; the showcase shell renders individual cells via iframe off the
// manifest, not this page. The list mirrors the framework sibling
// (ms-agent-dotnet) so the harness column reaches full-feature parity, with
// harness branding preserved.
const demos: { slug: string; title: string; description: string }[] = [
  {
    slug: "beautiful-chat",
    title: "Beautiful Chat",
    description: "Polished starter chat backed by Microsoft Agent Harness",
  },
  {
    slug: "agentic-chat",
    title: "Agentic Chat",
    description: "Natural conversation with frontend tool execution",
  },
  {
    slug: "frontend-tools",
    title: "Frontend Tools",
    description: "Agent invokes client-defined tools",
  },
  {
    slug: "frontend-tools-async",
    title: "Frontend Tools (Async)",
    description: "Client-side tools that resolve asynchronously",
  },
  {
    slug: "chat-customization-css",
    title: "Chat Customization (CSS)",
    description: "Styling the prebuilt chat surface",
  },
  {
    slug: "chat-slots",
    title: "Chat Slots",
    description: "Overriding chat UI via component slots",
  },
  {
    slug: "prebuilt-sidebar",
    title: "Prebuilt Sidebar",
    description: "Drop-in sidebar chat experience",
  },
  {
    slug: "prebuilt-popup",
    title: "Prebuilt Popup",
    description: "Drop-in popup chat experience",
  },
  {
    slug: "headless-simple",
    title: "Headless (Simple)",
    description: "Building a custom chat UI on the headless API",
  },
  {
    slug: "headless-complete",
    title: "Headless (Complete)",
    description: "Full headless chat with all features wired by hand",
  },
  {
    slug: "hitl",
    title: "Human in the Loop",
    description: "User approves agent actions before execution",
  },
  {
    slug: "hitl-in-app",
    title: "Human in the Loop (In App)",
    description: "Approval surfaced inline in the application UI",
  },
  {
    slug: "hitl-in-chat",
    title: "Human in the Loop (In Chat)",
    description: "Approval surfaced inline in the chat thread",
  },
  {
    slug: "tool-rendering",
    title: "Tool Rendering",
    description: "Backend agent tools rendered as UI components",
  },
  {
    slug: "tool-rendering-reasoning-chain",
    title: "Tool Rendering (Reasoning Chain)",
    description: "Tool calls interleaved with streamed reasoning",
  },
  {
    slug: "tool-rendering-default-catchall",
    title: "Tool Rendering (Default Catch-All)",
    description: "Default renderer for unhandled tool calls",
  },
  {
    slug: "tool-rendering-custom-catchall",
    title: "Tool Rendering (Custom Catch-All)",
    description: "Custom catch-all renderer for tool calls",
  },
  {
    slug: "reasoning-default",
    title: "Reasoning (Default)",
    description: "Streamed agent reasoning with the default renderer",
  },
  {
    slug: "reasoning-custom",
    title: "Reasoning (Custom)",
    description: "Streamed agent reasoning with a custom renderer",
  },
  {
    slug: "gen-ui-tool-based",
    title: "Tool-Based Generative UI",
    description: "Agent uses tools to trigger UI generation",
  },
  {
    slug: "gen-ui-agent",
    title: "Agentic Generative UI",
    description: "Long-running agent tasks with generated UI",
  },
  {
    slug: "gen-ui-interrupt",
    title: "Generative UI (Interrupt)",
    description: "Interrupt-driven generative UI",
  },
  {
    slug: "interrupt-headless",
    title: "Interrupt (Headless)",
    description: "Headless handling of agent interrupts",
  },
  {
    slug: "declarative-gen-ui",
    title: "Declarative Generative UI",
    description: "Declarative A2UI spec rendering",
  },
  {
    slug: "declarative-hashbrown",
    title: "Declarative (Hashbrown)",
    description: "BYOC rendering via Hashbrown",
  },
  {
    slug: "declarative-json-render",
    title: "Declarative (JSON Render)",
    description: "BYOC rendering from a JSON spec",
  },
  {
    slug: "a2ui-fixed-schema",
    title: "A2UI (Fixed Schema)",
    description: "Agent-to-UI rendering against a fixed schema",
  },
  {
    slug: "open-gen-ui",
    title: "Open Generative UI",
    description: "Open-ended generative UI",
  },
  {
    slug: "open-gen-ui-advanced",
    title: "Open Generative UI (Advanced)",
    description: "Advanced open-ended generative UI",
  },
  {
    slug: "mcp-apps",
    title: "MCP Apps",
    description: "Embedding MCP-served apps in chat",
  },
  {
    slug: "multimodal",
    title: "Multimodal",
    description: "Text plus image / file inputs",
  },
  {
    slug: "voice",
    title: "Voice",
    description: "Voice input and transcription",
  },
  {
    slug: "auth",
    title: "Auth",
    description: "Authenticated agent sessions",
  },
  {
    slug: "agent-config",
    title: "Agent Config",
    description: "Reconfiguring the agent from shared state per turn",
  },
  {
    slug: "shared-state-read",
    title: "Shared State (Reading)",
    description: "Reading agent state from UI",
  },
  {
    slug: "shared-state-read-write",
    title: "Shared State (Read/Write)",
    description: "Reading and writing agent state from UI",
  },
  {
    slug: "shared-state-streaming",
    title: "State Streaming",
    description: "Per-token state delta streaming from agent to UI",
  },
  {
    slug: "readonly-state-agent-context",
    title: "Read-Only State (Agent Context)",
    description: "Surfacing read-only agent context to the UI",
  },
  {
    slug: "subagents",
    title: "Sub-Agents",
    description: "Multiple agents with visible task delegation",
  },
];

export default function Home() {
  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1>MS Agent Harness (.NET)</h1>
      <p>Integration ID: ms-agent-harness-dotnet</p>
      <h2 style={{ marginTop: "2rem" }}>Demos</h2>
      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        {demos.map((demo) => (
          <a key={demo.slug} href={`/demos/${demo.slug}`} className="demo-card">
            <h3>{demo.title}</h3>
            <p>{demo.description}</p>
          </a>
        ))}
      </div>
    </main>
  );
}
