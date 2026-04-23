import { CopilotKit } from "@copilotkit/react-core";

function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <CopilotKit runtimeUrl="/api/copilotkit" publicApiKey="pk_test">
        <div />
      </CopilotKit>
    </AuthProvider>
  );
}
