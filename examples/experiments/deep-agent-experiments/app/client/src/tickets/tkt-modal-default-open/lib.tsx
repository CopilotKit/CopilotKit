import { useEffect, useRef } from "react";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";

export const TAG = "[tkt-modal-default-open]";

export function logVerdict(test: string, expected: unknown, actual: unknown) {
  const pass = expected === actual;
  const icon = pass ? "PASS" : "FAIL";
  const style = pass
    ? "color: green; font-weight: bold"
    : "color: red; font-weight: bold";
  console.log(
    `%c${icon}%c ${TAG} ${test}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`,
    style,
    "color: inherit",
  );
}

/**
 * Reads isModalOpen from the nearest CopilotChatConfigurationProvider
 * and renders a PASS/FAIL badge comparing against the expected value.
 * Also logs a one-time verdict to the console.
 */
export function ModalProbe({
  label,
  expected,
}: {
  label: string;
  expected: boolean | undefined;
}) {
  const config = useCopilotChatConfiguration();
  const actual = config?.isModalOpen;
  const logged = useRef(false);

  useEffect(() => {
    if (!logged.current) {
      logVerdict(label, expected, actual);
      logged.current = true;
    }
  }, [label, expected, actual]);

  const pass = expected === actual;

  return (
    <div
      className={`text-xs font-mono p-3 rounded-lg border-2 ${
        pass
          ? "bg-green-50 border-green-400 text-green-800"
          : "bg-red-50 border-red-400 text-red-800"
      }`}
    >
      <div className="font-bold">
        {pass ? "PASS" : "FAIL"} — {label}
      </div>
      <div>
        expected isModalOpen={String(expected)}, got{" "}
        <strong>{String(actual)}</strong>
      </div>
    </div>
  );
}
