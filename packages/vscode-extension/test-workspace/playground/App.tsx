import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { AuthProvider } from "./providers/AuthProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { Actions } from "./v1/Actions";
import { Data as V1Data } from "./v1/Data";
import { Chat } from "./v1/Chat";
import { Tools } from "./v2/Tools";
import { Rendering } from "./v2/Rendering";
import { Data as V2Data } from "./v2/Data";

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider mode="dark">
        <CopilotKitProvider
          runtimeUrl="/api/copilotkit"
          publicApiKey="pk_test_playground"
          properties={{ tenant: "acme", featureFlags: { beta: true } }}
        >
          <main>
            <Actions />
            <V1Data />
            <Chat />
            <Tools />
            <Rendering />
            <V2Data />
          </main>
        </CopilotKitProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
