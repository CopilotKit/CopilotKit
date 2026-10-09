import { HttpAgent } from "@ag-ui/client";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKit,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const agent = new HttpAgent({
  url: import.meta.env.DEV
    ? "http://127.0.0.1:8000/ag-ui"
    : `${window.location.origin}/ag-ui`,
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CopilotKit selfManagedAgents={{ echo: agent }}>
      <CopilotChatConfigurationProvider agentId="echo">
        <main>
          <h1>Self-managed agent</h1>
          <p>The chat below connects directly to the Python AG-UI endpoint.</p>
          <CopilotChat />
        </main>
      </CopilotChatConfigurationProvider>
    </CopilotKit>
  </React.StrictMode>,
);
