/**
 * ## Scenario: Baseline (default slots)
 *
 * Renders CopilotSidebar with NO custom slot overrides.
 * This is the expected working state for comparison.
 *
 * Component tree:
 *   CopilotKit (dummy runtime — no backend needed for UI test)
 *     └─ CopilotSidebar (defaultOpen, all default slots)
 *
 * Expected: Sidebar opens with header, welcome screen, and input all visible.
 */

import {
  CopilotKitProvider,
  CopilotSidebar,
} from "@copilotkit/react-core/v2";
import { HttpAgent } from "@ag-ui/client";

const TAG = "[tkt-sidebar-custom-slots baseline]";
const RUNTIME_URL = "/api/tickets/tkt-sidebar-custom-slots/copilot";

export function ScenarioBaseline() {
  console.log(TAG, "Rendering baseline scenario — default slots, no overrides");

  return (
    <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        agents__unsafe_dev_only={{
          default: new HttpAgent({ url: RUNTIME_URL }),
        }}
      >
      <div className="h-[600px] relative border rounded overflow-hidden">
        <p className="p-4 text-gray-400">
          Main content area. Sidebar should appear on the right with default
          header, messages, and input — all visible.
        </p>
        <CopilotSidebar defaultOpen={true} />
      </div>
    </CopilotKitProvider>
  );
}
