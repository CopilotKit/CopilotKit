import { CopilotKit } from "@copilotkit/react-core";

const api = { key: "pk_abc" };

export default function App() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      publicApiKey={api.key}
      onError={(err) => console.error(err)}
      properties={{ tenant: "acme", nested: { x: 1 } }}
      headers={{ "x-user": "alice" }}
    >
      <div />
    </CopilotKit>
  );
}
