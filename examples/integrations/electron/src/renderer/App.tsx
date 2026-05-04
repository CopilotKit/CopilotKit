import { useEffect, useState } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";

export function App() {
  const [runtimeUrl, setRuntimeUrl] = useState<string | null>(null);

  useEffect(() => {
    window.copilotkit.getRuntimeUrl().then(setRuntimeUrl);
  }, []);

  if (!runtimeUrl) {
    return <div className="loading">Starting embedded runtime…</div>;
  }

  return (
    <CopilotKit runtimeUrl={runtimeUrl}>
      <div className="app-shell">
        <header>
          <h1>CopilotKit · Electron</h1>
          <span className="runtime-url">{runtimeUrl}</span>
        </header>
        <main>
          <CopilotChat />
        </main>
      </div>
    </CopilotKit>
  );
}
