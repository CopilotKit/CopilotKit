/**
 * ## Scenario: Broken (custom slot overrides)
 *
 * Reproduces the reported issue: passing custom `header`, `input`, and
 * `messageView` slot functions to CopilotSidebar.
 *
 * Component tree:
 *   CopilotKit (dummy runtime)
 *     └─ CopilotSidebar
 *          header  → () => <p>Header</p>
 *          input   → () => <p>Input</p>
 *          messageView → () => <p>Messages</p>
 *
 * Bug 1 — Input not visible:
 *   The default CopilotChatInput uses `position: absolute; bottom: 0` to
 *   overlay on the scroll area. A custom input component ignores the
 *   `positioning` prop → renders in normal document flow → pushed below
 *   the full-height ScrollView → clipped by `overflow-hidden` on the
 *   `data-sidebar-chat` container.
 *
 * Bug 2 — messageView cut off from top:
 *   The ScrollView's content gets paddingBottom calculated from
 *   `inputContainerHeight`, which stays 0 because the custom input
 *   doesn't attach the `containerRef`. The scroll area + feather gradient
 *   may obscure the top of the message content.
 */

import {
  CopilotKitProvider,
  CopilotSidebar,
} from "@copilotkit/react-core/v2";
import { HttpAgent } from "@ag-ui/client";

const TAG = "[tkt-sidebar-custom-slots broken]";
const RUNTIME_URL = "/api/tickets/tkt-sidebar-custom-slots/copilot";

export function ScenarioBroken() {
  console.log(
    TAG,
    "Rendering broken scenario — custom header, input, messageView"
  );

  return (
    <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        agents__unsafe_dev_only={{
          default: new HttpAgent({ url: RUNTIME_URL }),
        }}
      >
      <div className="h-[600px] relative border rounded overflow-hidden">
        <p className="p-4 text-gray-400">
          Main content area. Sidebar should show custom Header, Messages, and
          Input — but Input is not visible and Messages is cut off.
        </p>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <CopilotSidebar
          defaultOpen={true}
          header={(() => {
            console.log(TAG, "header slot rendered");
            return (
              <p className="p-4 border-b font-semibold bg-yellow-100">
                Custom Header
              </p>
            );
          }) as any}
          input={(() => {
            console.log(TAG, "input slot rendered");
            return (
              <p className="p-2 border-t bg-red-100">
                Custom Input — if you can see this, the bug is fixed
              </p>
            );
          }) as any}
          messageView={(() => {
            console.log(TAG, "messageView slot rendered");
            return (
              <p className="p-4 bg-blue-100">
                Custom Messages — this should be fully visible, not cut off
              </p>
            );
          }) as any}
        />
      </div>
    </CopilotKitProvider>
  );
}
