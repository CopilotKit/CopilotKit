import { CopilotChat, CopilotKit, useAgent } from "@copilotkit/react-core";
import "@copilotkit/react-core/styles.css";

export function App() {
  const { agent } = useAgent();
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agentId="default">
      <CopilotChat />
    </CopilotKit>
  );
}
