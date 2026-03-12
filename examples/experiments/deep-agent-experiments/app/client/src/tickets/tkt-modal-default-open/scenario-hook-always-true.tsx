/**
 * Scenario 1 — Hook reads true even when user sets isModalDefaultOpen=false
 *
 * The user wraps their tree with CopilotChatConfigurationProvider and sets
 * isModalDefaultOpen={false}. They read isModalOpen from the hook expecting
 * false. But CopilotPopupView creates an INNER provider with defaultOpen=true
 * which shadows the user's provider.
 *
 * React tree:
 *
 *   CopilotChatConfigurationProvider  (USER's — isModalDefaultOpen=false)
 *     ├── ModalProbe                   ← reads from USER's provider → false ✓
 *     └── CopilotPopupView
 *           └── CopilotChatConfigurationProvider  (POPUP's — defaultOpen=true)
 *                 └── CopilotPopupViewInternal     ← reads from POPUP's provider → true
 *
 * The probe OUTSIDE the popup correctly reads false.
 * But the popup itself opens because its inner provider defaults to true.
 */

import {
  CopilotKitProvider,
  CopilotPopupView,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { TAG, ModalProbe } from "./lib";

export function HookAlwaysTrueScenario() {
  console.log(`\n${TAG} ===== Scenario: Hook always returns true =====`);
  console.log(`${TAG} Setup: outer provider has isModalDefaultOpen=false`);
  console.log(`${TAG} CopilotPopupView creates its own inner provider with defaultOpen=true`);
  console.log(`${TAG} Probe OUTSIDE popup should read false; popup itself opens as true\n`);

  return (
    <CopilotKitProvider>
      <div className="p-4 space-y-4">
        <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
          <ModalProbe
            label="Reading from user's outer provider (isModalDefaultOpen=false)"
            expected={false}
          />

          <div className="mt-3 text-xs text-gray-500">
            CopilotPopupView below creates its own inner provider with
            defaultOpen=true. The popup opens despite the user setting false on
            their provider. Use the toggle button (bottom-right) to interact.
          </div>

          <CopilotPopupView messages={[]} isRunning={false} />
        </CopilotChatConfigurationProvider>
      </div>
    </CopilotKitProvider>
  );
}
