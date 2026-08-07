import React from "react";
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import { VizToolRenderers } from "./viz/renderers";

// Same-origin by default (the dev proxy and single-process deploys both serve
// /api/copilotkit); set VITE_COPILOT_RUNTIME_URL at build time when the
// frontend is hosted separately from the runtime.
const runtimeUrl =
  import.meta.env.VITE_COPILOT_RUNTIME_URL || "/api/copilotkit";

export const App: React.FC = () => (
  <CopilotKitProvider runtimeUrl={runtimeUrl}>
    <VizToolRenderers />
    <div className="app">
      <header>
        <h1>
          Finance assistant{" "}
          <span className="header-dim">· Claude Managed Agents × AG-UI</span>
        </h1>
        <p>A helpful personal finance agent to bounce ideas off of.</p>
      </header>
      <div className="chat-shell">
        <CopilotChat
          agentId="financial-assistant"
          labels={{
            chatInputPlaceholder:
              "Share your financial picture or ask about planning for the future…",
          }}
        />
      </div>
    </div>
  </CopilotKitProvider>
);
