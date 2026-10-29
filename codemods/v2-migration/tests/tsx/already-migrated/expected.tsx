import { CopilotChat, CopilotKitProvider, useAgent } from "@copilotkit/react-core";
import "@copilotkit/react-core/styles.css";

export function App() {
  const { agent } = useAgent();
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="default">
      <CopilotChat />
    </CopilotKitProvider>
  );
}
