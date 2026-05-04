import { frameworks, isReachable } from "@/registry/frameworks";

export default function HomePage() {
  const configured = Object.values(frameworks).filter(isReachable);
  return (
    <main style={{ maxWidth: 760, margin: "4rem auto", padding: "0 1rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 600 }}>CopilotKit Integrations Showcase</h1>
      {configured.length === 0 ? (
        <section style={{ marginTop: "2rem", padding: "1.5rem", border: "1px solid #ddd", borderRadius: 8 }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>No frameworks configured</h2>
          <p style={{ marginTop: "0.5rem", color: "#555" }}>
            Set <code>&lt;FRAMEWORK&gt;_BACKEND_URL</code> environment variables and add entries to <code>src/registry/frameworks.ts</code>.
          </p>
        </section>
      ) : (
        <section style={{ marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Configured frameworks</h2>
          <ul style={{ marginTop: "0.5rem" }}>
            {configured.map((fw) => (
              <li key={fw.slug}>
                <strong>{fw.name}</strong> ({fw.language}) — <code>{fw.backendUrl}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
