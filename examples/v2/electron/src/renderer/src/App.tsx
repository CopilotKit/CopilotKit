import { useEffect, useState } from "react";
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core/v2";

export default function App() {
  const [runtimeUrl, setRuntimeUrl] = useState<string | null>(null);

  useEffect(() => {
    void window.electron.runtime.getUrl().then(setRuntimeUrl);
  }, []);

  if (runtimeUrl === null) {
    return <div style={{ padding: 24 }}>Starting CopilotKit runtime…</div>;
  }

  return (
    <CopilotKitProvider runtimeUrl={runtimeUrl} showDevConsole="auto">
      <main style={{ display: "flex", height: "100vh" }}>
        <section style={{ flex: 1, padding: 24 }}>
          <h1>CopilotKit Electron Starter</h1>
          <p>
            An AI-powered desktop app built with Electron and CopilotKit. Ask
            the assistant anything using the sidebar on the right.
          </p>
        </section>
        <CopilotSidebar />
      </main>
    </CopilotKitProvider>
  );
}
