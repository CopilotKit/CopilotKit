import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1>LangGraph (Python)</h1>
      <p>Integration ID: langgraph-python</p>
      <h2 style={{ marginTop: "2rem" }}>Demos</h2>
      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        <Link key="agentic-chat" href="/demos/agentic-chat" className="demo-card">
          <h3>Agentic Chat</h3>
          <p>Natural conversation with frontend tool execution</p>
        </Link>
        <Link key="hitl" href="/demos/hitl" className="demo-card">
          <h3>Human in the Loop</h3>
          <p>User approves agent actions before execution</p>
        </Link>
        <Link
          key="tool-rendering"
          href="/demos/tool-rendering"
          className="demo-card"
        >
          <h3>Tool Rendering</h3>
          <p>Backend agent tools rendered as UI components</p>
        </Link>
        <Link
          key="gen-ui-tool-based"
          href="/demos/gen-ui-tool-based"
          className="demo-card"
        >
          <h3>Tool-Based Generative UI</h3>
          <p>Agent uses tools to trigger UI generation</p>
        </Link>
        <Link key="gen-ui-agent" href="/demos/gen-ui-agent" className="demo-card">
          <h3>Agentic Generative UI</h3>
          <p>Long-running agent tasks with generated UI</p>
        </Link>
        <Link
          key="shared-state-read"
          href="/demos/shared-state-read"
          className="demo-card"
        >
          <h3>Shared State (Reading)</h3>
          <p>Reading agent state from UI</p>
        </Link>
        <Link
          key="shared-state-write"
          href="/demos/shared-state-write"
          className="demo-card"
        >
          <h3>Shared State (Writing)</h3>
          <p>Writing to agent state from UI</p>
        </Link>
        <Link
          key="shared-state-streaming"
          href="/demos/shared-state-streaming"
          className="demo-card"
        >
          <h3>State Streaming</h3>
          <p>Per-token state delta streaming from agent to UI</p>
        </Link>
        <Link key="subagents" href="/demos/subagents" className="demo-card">
          <h3>Sub-Agents</h3>
          <p>Multiple agents with visible task delegation</p>
        </Link>
      </div>
    </main>
  );
}
