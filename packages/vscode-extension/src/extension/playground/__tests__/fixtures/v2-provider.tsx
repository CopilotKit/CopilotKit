import { CopilotKitProvider } from "@copilotkit/react-core/v2";

export default function App() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" publicApiKey="pk_v2">
      <div />
    </CopilotKitProvider>
  );
}
