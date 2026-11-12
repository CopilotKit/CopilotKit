import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core/v2";

export default function Page() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="weather" showDevConsole={false}>
      <CopilotSidebar />
    </CopilotKit>
  );
}
