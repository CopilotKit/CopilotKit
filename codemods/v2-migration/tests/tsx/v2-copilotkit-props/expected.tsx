import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core";

export default function Page() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agentId="weather" showDevConsole={false}>
      <CopilotSidebar />
    </CopilotKit>
  );
}
