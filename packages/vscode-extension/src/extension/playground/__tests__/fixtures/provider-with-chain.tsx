import { CopilotKit } from "@copilotkit/react-core";

function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
function ThemeProvider({ children, mode }: { children: React.ReactNode; mode: string }) {
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider mode="dark">
        <CopilotKit runtimeUrl="/api/copilotkit">
          <div />
        </CopilotKit>
      </ThemeProvider>
    </AuthProvider>
  );
}
