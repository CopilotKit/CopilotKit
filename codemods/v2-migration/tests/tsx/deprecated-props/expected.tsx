import { CopilotChatView, CopilotKitProvider as Provider } from "@copilotkit/react-core";
import { A2UIRenderer } from "@copilotkit/a2ui-renderer";

export function App({ Disclaimer }: { Disclaimer: () => null }) {
  return (
    <Provider runtimeUrl="/api/copilotkit">
      <CopilotChatView /* TODO(copilotkit-2.0): `disclaimer` was removed from `CopilotChatView`. Pass it to the input slot: `input={{ disclaimer: ... }}`. */ disclaimer={Disclaimer} />
      <A2UIRenderer surfaceId="main" />
    </Provider>
  );
}
