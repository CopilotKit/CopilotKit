import { CopilotKit } from "@copilotkit/react-core";

export function MainApp() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <main>main</main>
    </CopilotKit>
  );
}

export function AdminApp() {
  return (
    <CopilotKit runtimeUrl="/api/admin-copilotkit">
      <aside>admin</aside>
    </CopilotKit>
  );
}
