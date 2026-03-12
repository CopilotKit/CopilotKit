/**
 * Scenario 2 — defaultOpen cannot be changed after mount (no controlled prop)
 *
 * In v1:  <CopilotSidebar open={isOpen} onSetOpen={setIsOpen} />
 * In v2:  only defaultOpen exists — it seeds useState on mount, then is ignored.
 *
 * This scenario passes desiredOpen as defaultOpen. Clicking the buttons toggles
 * desiredOpen, but the popup never reacts because useState already captured the
 * initial value.
 *
 * This is intentionally broken — it demonstrates the missing controlled prop.
 */

import { useState, useRef } from "react";
import {
  CopilotKitProvider,
  CopilotPopupView,
} from "@copilotkit/react-core/v2";
import { TAG } from "./lib";

export function NoControlledPropScenario() {
  const [desiredOpen, setDesiredOpen] = useState(false);
  const clickCount = useRef(0);

  console.log(`\n${TAG} ===== Scenario: No controlled open prop =====`);
  console.log(`${TAG} Setup: defaultOpen driven by React state (starts false)`);
  console.log(`${TAG} Clicking buttons changes state, but CopilotPopupView ignores re-renders\n`);

  return (
    <CopilotKitProvider>
      <div className="p-4 space-y-4">
        <div className="flex gap-3 items-center">
          <button
            onClick={() => {
              clickCount.current++;
              setDesiredOpen(true);
              console.log(
                `%cACTION%c ${TAG} Set open=true (click #${clickCount.current})`,
                "color: blue; font-weight: bold",
                "color: inherit",
              );
              console.log(`${TAG} → defaultOpen={true} passed, but popup ignores it after mount`);
            }}
            className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700"
          >
            Set open=true
          </button>
          <button
            onClick={() => {
              clickCount.current++;
              setDesiredOpen(false);
              console.log(
                `%cACTION%c ${TAG} Set open=false (click #${clickCount.current})`,
                "color: blue; font-weight: bold",
                "color: inherit",
              );
              console.log(`${TAG} → defaultOpen={false} passed, but popup ignores it after mount`);
            }}
            className="px-4 py-2 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700"
          >
            Set open=false
          </button>
          <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
            desiredOpen={String(desiredOpen)}
          </span>
        </div>

        <div className="text-xs text-gray-500">
          Click "Set open=true" — nothing happens. The popup stays in whatever
          state it was. This is the bug: there's no <code>open</code> controlled
          prop in v2. Use the built-in toggle button (bottom-right) to verify the
          popup itself works.
        </div>

        <CopilotPopupView
          defaultOpen={desiredOpen}
          messages={[]}
          isRunning={false}
        />
      </div>
    </CopilotKitProvider>
  );
}
