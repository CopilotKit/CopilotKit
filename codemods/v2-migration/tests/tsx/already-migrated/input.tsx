import { CopilotChat, CopilotKitProvider, useAgent } from "@copilotkit/react-core";

export function App() {
  const { agent } = useAgent();
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="default">
      <CopilotChat />
    </CopilotKitProvider>
  );
}
