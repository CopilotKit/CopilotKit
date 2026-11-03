import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/react-core";

export default function Page() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="weather">
      <CopilotSidebar />
    </CopilotKitProvider>
  );
}
