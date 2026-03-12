/**
 * tkt-runtime-error-handling
 *
 * Issue: When the CopilotKit runtime is unreachable (e.g. /info call fails),
 * the error bubbles up and hits the user's error boundary. There is no
 * graceful way to handle this on the UI side — no onError callback fires
 * unless publicApiKey is set.
 *
 * This ticket reproduces the problem by pointing CopilotKit at a non-existent
 * runtime URL and rendering a CopilotChat. The user wants either:
 *   1. An onError callback that works without publicApiKey
 *   2. A way to pass static agentIds to skip the /info call entirely
 */

import { useState } from "react";
import type { TicketMeta } from "../lib/ticket-types";
import ScenarioUnhandled from "./scenario-unhandled";
import ScenarioOnError from "./scenario-on-error";

export const meta: TicketMeta = {
  title: "Runtime connection error bubbles to error boundary",
  refs: [
    "https://copilotkit.slack.com/archives/C09C1BLEPC1/p1771375504525019",
  ],
  notes:
    "When /info (or any initial connection) fails, error is unhandled. User wants onError callback on CopilotKit provider that works without publicApiKey.",
};

const scenarios = [
  { id: "unhandled", label: "Unhandled (current behavior)", Component: ScenarioUnhandled },
  { id: "on-error", label: "With onError (desired behavior)", Component: ScenarioOnError },
] as const;

export default function TktRuntimeErrorHandling() {
  const [active, setActive] = useState<string>(scenarios[0].id);
  const ActiveScenario = scenarios.find((s) => s.id === active)!.Component;

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              console.log(`[tkt-runtime-error-handling] Switching to scenario: ${s.id}`);
              setActive(s.id);
            }}
            className={`px-3 py-1.5 rounded text-sm border ${
              active === s.id
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <ActiveScenario key={active} />
    </div>
  );
}
