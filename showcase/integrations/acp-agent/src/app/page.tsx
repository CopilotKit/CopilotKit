import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1>ACP Agent via Intelligence</h1>
      <p>ACP v1 agents behind a durable AG-UI service.</p>
      <h2 style={{ marginTop: "2rem" }}>Demos</h2>
      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        <Link href="/demos/agentic-chat" className="demo-card">
          <h3>Pre-Built: CopilotChat</h3>
          <p>Full-screen chat backed by an ACP agent profile.</p>
        </Link>
        <Link href="/demos/reasoning-default" className="demo-card">
          <h3>Reasoning: Default</h3>
          <p>ACP thought chunks in the built-in reasoning view.</p>
        </Link>
        <Link href="/demos/prebuilt-sidebar" className="demo-card">
          <h3>Pre-Built: Sidebar</h3>
          <p>The same ACP agent in the standard docked sidebar.</p>
        </Link>
      </div>
    </main>
  );
}
