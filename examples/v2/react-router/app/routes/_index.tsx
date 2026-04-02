import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export default function Index() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
      <div className="h-screen w-screen">
        <CopilotChat className="h-full w-full" />
      </div>
    </CopilotKitProvider>
  );
}
