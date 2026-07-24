export default function Home() {
  return (
    <main
      style={{
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1>Personal Finance Copilot — CopilotKit Runtime</h1>
      <p>
        This server hosts the CopilotKit runtime that the React Native app
        connects to. It exposes two endpoints:
      </p>
      <ul>
        <li>
          <code>POST /api/copilotkit</code> — the CopilotKit runtime (AG-UI)
          hosting the <code>default</code> finance assistant agent.
        </li>
        <li>
          <code>POST /api/receipt</code> — vision-based receipt parser returning{" "}
          <code>{`{ merchant, amount, currency, date, suggestedCategory }`}</code>
          .
        </li>
      </ul>
      <p>
        Point the RN app&apos;s <code>CopilotKitProvider runtimeUrl</code> at{" "}
        <code>http://&lt;this-host&gt;:3000/api/copilotkit</code>. See{" "}
        <code>README.md</code> for setup.
      </p>
    </main>
  );
}
