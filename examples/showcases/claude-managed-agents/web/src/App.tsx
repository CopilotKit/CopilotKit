import React from "react";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import { VizToolRenderers } from "./viz/renderers";

// Same-origin by default (the dev proxy and single-process deploys both serve
// /api/copilotkit); set VITE_COPILOT_RUNTIME_URL at build time when the
// frontend is hosted separately from the runtime.
const runtimeUrl =
  import.meta.env.VITE_COPILOT_RUNTIME_URL || "/api/copilotkit";

export const App: React.FC = () => (
  <CopilotKitProvider runtimeUrl={runtimeUrl}>
    <CopilotChatConfigurationProvider
      agentId="financial-assistant"
      labels={{
        welcomeMessageText:
          "Explore investment planning with a Claude Managed Agent. Try the starter below.",
        chatInputPlaceholder:
          "Ask about planning for the future or share your financial picture…",
      }}
    >
      <VizToolRenderers />
      <main className="app">
        <section className="chat-shell">
          <CopilotChat />
        </section>
      </main>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);
