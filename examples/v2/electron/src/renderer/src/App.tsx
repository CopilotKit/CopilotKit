import { useEffect, useState } from "react";
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core/v2";
import { useLocalTools } from "./hitl/useLocalTools";
import { McpPanel } from "./mcp/McpPanel";
import { BridgePanel } from "./bridge/BridgePanel";
import { useBrowserActionTools } from "./hitl/useBrowserActionTools";

function WorkspaceTools(): null {
  useLocalTools();
  useBrowserActionTools();
  return null;
}

export default function App() {
  const [runtimeUrl, setRuntimeUrl] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");

  useEffect(() => {
    void window.electron.runtime.getUrl().then(setRuntimeUrl);
    void window.electron.workspace.getRoot().then(setWorkspaceRoot);
  }, []);

  if (runtimeUrl === null) {
    return <div style={{ padding: 24 }}>Starting CopilotKit runtime…</div>;
  }

  return (
    <CopilotKitProvider runtimeUrl={runtimeUrl} showDevConsole="auto">
      <WorkspaceTools />
      <main style={{ display: "flex", height: "100vh" }}>
        <section style={{ flex: 1, padding: 24 }}>
          <h1>CopilotKit Electron Starter</h1>
          <p>
            An AI-powered desktop app built with Electron and CopilotKit. Ask
            the assistant anything using the sidebar on the right.
          </p>
          <p data-testid="workspace-root">Workspace: {workspaceRoot || "…"}</p>
          <div style={{ marginTop: 24 }}>
            <McpPanel />
          </div>
          <div style={{ marginTop: 24 }}>
            <BridgePanel />
          </div>
        </section>
        <CopilotSidebar />
      </main>
    </CopilotKitProvider>
  );
}
