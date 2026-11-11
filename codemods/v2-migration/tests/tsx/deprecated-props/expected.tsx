import { CopilotChatView, CopilotKitProvider as Provider } from "@copilotkit/react-core";
// TODO(copilotkit-2.0): The A2UI v0.9 client (`@copilotkit/a2ui-renderer`, `@copilotkit/angular/a2ui`) was removed in 2.0. Use generative UI from the framework's `/generative-ui` entry: `createGenerativeUI` and `standardUI` for catalogs, `GenerativeUISurface` for a surface, and `useGenerativeUIState` and `useGenerativeUIFunction` for state and actions. Then delete this import. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
import { A2UIRenderer } from "@copilotkit/a2ui-renderer";

export function App({ Disclaimer }: { Disclaimer: () => null }) {
  return (
    <Provider runtimeUrl="/api/copilotkit">
      <CopilotChatView /* TODO(copilotkit-2.0): `disclaimer` was removed from `CopilotChatView`. Pass it to the input slot: `input={{ disclaimer: ... }}`. */ disclaimer={Disclaimer} />
      <A2UIRenderer surfaceId="main" registry={{}} />
    </Provider>
  );
}
