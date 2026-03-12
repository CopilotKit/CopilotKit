/**
 * Scenario 3 — Workaround: control popup via setModalOpen() from inside
 * a user-created CopilotChatConfigurationProvider
 *
 * React tree:
 *
 *   CopilotChatConfigurationProvider  (USER's — isModalDefaultOpen=false)
 *     ├── WorkaroundButtons            ← reads from USER's provider
 *     └── CopilotPopupView
 *           └── CopilotChatConfigurationProvider  (POPUP's — defaultOpen=true)
 *                 └── CopilotPopupViewInternal     ← reads from POPUP's provider
 *
 * The buttons call setModalOpen() on the USER's provider.
 * Whether the popup responds depends on whether the POPUP's inner provider
 * delegates to the parent or uses its own state.
 *
 * On main (parentConfig?.isModalOpen ?? internalModalOpen):
 *   → inner provider reads from parent → buttons work
 *
 * With our isModalDefaultOpen fix:
 *   → inner provider uses its own state (because defaultOpen is explicit)
 *   → buttons update the outer state but popup doesn't see it
 */

import { useState, useEffect, useCallback } from "react";
import {
  CopilotKitProvider,
  CopilotPopupView,
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { TAG } from "./lib";

function WorkaroundButtons({
  onStateChange,
}: {
  onStateChange: (open: boolean) => void;
}) {
  const config = useCopilotChatConfiguration();
  const isOpen = config?.isModalOpen;
  const setModalOpen = config?.setModalOpen;

  useEffect(() => {
    console.log(`${TAG} Workaround — hook reports isModalOpen=${String(isOpen)}`);
    if (isOpen !== undefined) onStateChange(isOpen);
  }, [isOpen, onStateChange]);

  return (
    <div className="flex gap-3 items-center">
      <button
        onClick={() => {
          console.log(
            `%cACTION%c ${TAG} Workaround: calling setModalOpen(true)`,
            "color: blue; font-weight: bold",
            "color: inherit",
          );
          setModalOpen?.(true);
        }}
        className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700"
      >
        setModalOpen(true)
      </button>
      <button
        onClick={() => {
          console.log(
            `%cACTION%c ${TAG} Workaround: calling setModalOpen(false)`,
            "color: blue; font-weight: bold",
            "color: inherit",
          );
          setModalOpen?.(false);
        }}
        className="px-4 py-2 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700"
      >
        setModalOpen(false)
      </button>
      <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
        isModalOpen={String(isOpen)}
      </span>
    </div>
  );
}

export function WorkaroundScenario() {
  const [reportedState, setReportedState] = useState<boolean | undefined>(
    undefined,
  );
  const handleStateChange = useCallback(
    (open: boolean) => setReportedState(open),
    [],
  );

  console.log(`\n${TAG} ===== Scenario: Workaround (setModalOpen) =====`);
  console.log(`${TAG} Setup: outer provider with isModalDefaultOpen=false`);
  console.log(`${TAG} Buttons call setModalOpen() from INSIDE the outer provider\n`);

  return (
    <CopilotKitProvider>
      <div className="p-4 space-y-4">
        <div className="text-xs text-gray-500">
          These buttons call <code>setModalOpen()</code> from inside the outer
          provider. The popup sits inside the same provider but creates its own
          inner provider. Whether the popup responds depends on the inner
          provider's state resolution logic.
        </div>

        <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
          <WorkaroundButtons onStateChange={handleStateChange} />
          <CopilotPopupView messages={[]} isRunning={false} />
        </CopilotChatConfigurationProvider>

        <div className="text-xs text-gray-500">
          Parent sees (via callback):{" "}
          <code>{String(reportedState)}</code>
        </div>
      </div>
    </CopilotKitProvider>
  );
}
