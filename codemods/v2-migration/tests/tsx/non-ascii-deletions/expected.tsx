// Styles — loaded once → for every page (café).
import { CopilotKitProvider } from "@copilotkit/react-core";

// The provider — with the removed dev console prop.
export function App({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {children}
    </CopilotKitProvider>
  );
}
