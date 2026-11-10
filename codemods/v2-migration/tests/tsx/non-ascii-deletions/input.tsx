// Styles — loaded once → for every page (café).
import "@copilotkit/react-ui/styles.css";
import { CopilotKit } from "@copilotkit/react-core";

// The provider — with the removed dev console prop.
export function App({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" showDevConsole={true}>
      {children}
    </CopilotKit>
  );
}
