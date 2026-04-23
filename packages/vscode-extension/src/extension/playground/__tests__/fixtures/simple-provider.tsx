import { CopilotKit } from "@copilotkit/react-core";

export default function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" publicApiKey="pk_test">
      <div>hello</div>
    </CopilotKit>
  );
}
