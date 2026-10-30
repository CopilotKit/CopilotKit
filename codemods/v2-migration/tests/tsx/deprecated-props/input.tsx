import { CopilotChatView, CopilotKitProvider as Provider } from "@copilotkit/react-core/v2";
import { A2UIRenderer } from "@copilotkit/a2ui-renderer";

export function App({ Disclaimer }: { Disclaimer: () => null }) {
  return (
    <Provider runtimeUrl="/api/copilotkit" showDevConsole={false}>
      <CopilotChatView disclaimer={Disclaimer} />
      <A2UIRenderer surfaceId="main" registry={{}} />
    </Provider>
  );
}
