"use client";
import { CopilotKit } from "@copilotkit/react-core";
import Chat from "./Components/Chat";
import { CopilotChat, CopilotSidebar } from "@copilotkit/react-ui";
import { AgentProvider, useAgent } from "./Providers/AgentProvider";
export default function Home() {
  const { selectedAgent } = useAgent();
  return (
    // <AgentProvider>
    <CopilotKit runtimeUrl="/api/copilotkit" agent={selectedAgent?.name}>
      <div style={{
        "--copilot-kit-primary-color": "#ffff",
        "--copilot-kit-background-color": "#202a3c",
        "--copilot-kit-contrast-color": "#1e293b",
        "--copilot-kit-input-background-color": "oklch(21% .034 264.665)",
        "--copilot-kit-secondary-color": "oklch(21% .034 264.665)",
        "--copilot-kit-secondary-contrast-color": "#fffff",
        "--copilot-kit-separator-color": "oklch(21% .034 264.665)",
        "--copilot-kit-muted-color": "#FFFF",
        // "--copilot-kit-muted-color": "oklch(21% .034 264.665)",
        "--copilot-kit-shadow-sm": "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        "--copilot-kit-shadow-md": "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        "--copilot-kit-shadow-lg": "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
      } as React.CSSProperties}>
        {/* <CopilotSidebar> */}
        <Chat />
        {/* </CopilotSidebar> */}
      </div>
    </CopilotKit>
    // </AgentProvider>
  );
}
