/**
 * Scenario: Desired behavior — onError callback catches the failure
 *
 * Component tree:
 *   CopilotKit (runtimeUrl="http://localhost:59999/nonexistent", onError={handler})
 *     └── CopilotChat
 *
 * This scenario demonstrates what the user WANTS: an onError callback on the
 * CopilotKit provider that fires when the runtime connection fails, WITHOUT
 * requiring publicApiKey.
 *
 * Current behavior: onError only fires when publicApiKey is set (see
 * copilotkit.tsx line ~392: `if (copilotApiConfig.publicApiKey && onErrorRef.current)`).
 *
 * Desired behavior: onError fires regardless of publicApiKey. The user can
 * then decide how to handle the error (show a toast, retry, degrade gracefully).
 */

import { useEffect, useState, useCallback } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";

const TAG = "[tkt-runtime-error-handling][on-error]";

function CopilotChatInner() {
  useEffect(() => {
    console.log(TAG, "CopilotChat inner mounted — waiting for runtime connection...");
    return () => console.log(TAG, "CopilotChat inner unmounted");
  }, []);

  return (
    <CopilotChat
      className="h-[400px] border rounded"
      labels={{ title: "Chat (runtime is intentionally unreachable)" }}
    />
  );
}

export default function ScenarioOnError() {
  const [errors, setErrors] = useState<Array<{ time: string; message: string }>>([]);

  const handleError = useCallback((errorEvent: any) => {
    const message = errorEvent?.error?.message ?? String(errorEvent);
    console.log(TAG, "onError fired:", message);
    console.log(TAG, "Full error event:", JSON.stringify(errorEvent, null, 2));
    setErrors((prev) => [...prev, { time: new Date().toISOString(), message }]);
  }, []);

  console.log(TAG, "Rendering with onError handler (no publicApiKey)");

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Same broken runtime URL, but with an <code>onError</code> callback. Currently this does NOT
        fire without <code>publicApiKey</code>. The fix would remove the <code>publicApiKey</code>{" "}
        guard from the error handler dispatch.
      </p>

      {errors.length > 0 && (
        <div className="mb-3 p-3 bg-yellow-50 border border-yellow-300 rounded">
          <h4 className="font-semibold text-yellow-800 text-sm">
            onError callback fired ({errors.length} time{errors.length > 1 ? "s" : ""})
          </h4>
          {errors.map((e, i) => (
            <div key={i} className="mt-1 text-xs text-yellow-700">
              <span className="font-mono">{e.time}</span>: {e.message}
            </div>
          ))}
        </div>
      )}

      <CopilotKit runtimeUrl="http://localhost:59999/nonexistent" onError={handleError}>
        <CopilotChatInner />
      </CopilotKit>
    </div>
  );
}
