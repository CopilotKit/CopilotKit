export default function Home() {
  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1>MS Agent Harness (.NET)</h1>
      <p>Integration ID: ms-agent-harness-dotnet</p>
      <h2 style={{ marginTop: "2rem" }}>Demos</h2>
      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        <a
          key="beautiful-chat"
          href="/demos/beautiful-chat"
          className="demo-card"
        >
          <h3>Beautiful Chat</h3>
          <p>Polished starter chat backed by Microsoft Agent Harness</p>
        </a>
      </div>
    </main>
  );
}
