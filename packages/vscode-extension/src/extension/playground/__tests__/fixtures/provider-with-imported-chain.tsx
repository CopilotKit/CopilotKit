import { CopilotKit } from "@copilotkit/react-core";
import { AuthProvider } from "./providers/auth";
import { ThemeProvider as Theme } from "./providers/theme";
import Layout from "./layout";

export default function App() {
  return (
    <Layout>
      <AuthProvider>
        <Theme mode="dark">
          <CopilotKit runtimeUrl="/api/copilotkit">
            <div />
          </CopilotKit>
        </Theme>
      </AuthProvider>
    </Layout>
  );
}
