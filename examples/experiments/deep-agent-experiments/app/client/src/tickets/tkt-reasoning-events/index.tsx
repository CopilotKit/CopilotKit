import { useState } from "react";
import type { TicketMeta } from "@/lib/ticket-types";
import ScenarioDeprecated from "./scenario-deprecated";
import ScenarioReasoning from "./scenario-reasoning";

export const meta: TicketMeta = {
  title: "Reasoning events not received via agent.subscribe() onEvent",
  refs: [
    "https://copilotkit.slack.com/archives/C09C1BLEPC1/p1772757286099949",
  ],
  notes:
    "User subscribes with onEvent checking EventType.THINKING_TEXT_MESSAGE_* (deprecated). " +
    "These are never emitted — BuiltInAgent emits REASONING_* events. " +
    "Additionally, GPT-5-Nano may not produce reasoning events at all (only o3/o4-mini do). " +
    "Server uses BuiltInAgent with o4-mini to confirm reasoning events flow through.",
};

type Scenario = "deprecated" | "reasoning" | null;

export default function TktReasoningEvents() {
  const [active, setActive] = useState<Scenario>(null);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-bold mb-2">
        Reasoning events not received via agent.subscribe()
      </h2>
      <p className="text-sm text-gray-600 mb-2">
        Two issues: (1) user checks deprecated <code>THINKING_TEXT_MESSAGE_*</code> event types in{" "}
        <code>onEvent</code> — these are never emitted, use <code>REASONING_*</code> instead.
        (2) GPT-5-Nano may not produce reasoning events — only <code>o3</code>,{" "}
        <code>o3-mini</code>, <code>o4-mini</code> do.
      </p>
      <p className="text-sm text-gray-500 mb-4">
        Server uses <code>BuiltInAgent</code> with <code>o4-mini</code> to confirm reasoning works.
        Select one scenario at a time. Check console for{" "}
        <code>[tkt-reasoning-events]</code> logs.
      </p>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setActive(active === "deprecated" ? null : "deprecated")}
          className={`rounded-lg px-4 py-2 text-sm font-medium border ${
            active === "deprecated"
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Deprecated: onEvent + THINKING types (broken)
        </button>
        <button
          onClick={() => setActive(active === "reasoning" ? null : "reasoning")}
          className={`rounded-lg px-4 py-2 text-sm font-medium border ${
            active === "reasoning"
              ? "bg-green-600 text-white border-green-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Correct: onReasoning* callbacks (works)
        </button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {active === "deprecated" && <ScenarioDeprecated />}
        {active === "reasoning" && <ScenarioReasoning />}
        {active === null && (
          <div className="p-12 text-center text-gray-400 text-sm">
            Select a scenario above to start
          </div>
        )}
      </div>

      <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
        <h3 className="font-semibold text-sm text-amber-800 mb-2">Root cause analysis</h3>
        <div className="text-xs text-amber-700 space-y-2">
          <p>
            <strong>Issue 1 — Wrong event types:</strong> The user's code checks{" "}
            <code>EventType.THINKING_TEXT_MESSAGE_START/CONTENT/END</code> in{" "}
            <code>onEvent</code>. These are <em>deprecated</em> aliases. The BuiltInAgent emits{" "}
            <code>REASONING_START</code>, <code>REASONING_MESSAGE_START/CONTENT/END</code>,{" "}
            <code>REASONING_END</code>. Use the dedicated subscriber callbacks:{" "}
            <code>onReasoningStartEvent</code>, <code>onReasoningMessageContentEvent</code>, etc.
          </p>
          <p>
            <strong>Issue 2 — Model doesn't support reasoning:</strong> GPT-5-Nano is a regular
            chat model. Only OpenAI's reasoning models (<code>o3</code>, <code>o3-mini</code>,{" "}
            <code>o4-mini</code>) produce <code>reasoning-start/delta/end</code> events in the
            AI SDK stream. With a non-reasoning model, there are simply no reasoning events to
            capture.
          </p>
        </div>
      </div>
    </div>
  );
}
