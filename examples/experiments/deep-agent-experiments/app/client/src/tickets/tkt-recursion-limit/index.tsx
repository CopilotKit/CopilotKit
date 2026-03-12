import { useState, useEffect } from "react";
import type { TicketMeta } from "../lib/ticket-types";
import { CopilotKit } from "@copilotkit/react-core";
import { useCoAgent } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title: "recursion_limit=100 ignored, default 25 enforced",
  refs: [
    "https://copilotkit.slack.com/archives/C08BHK2SZL4/p1771494139500499",
  ],
  notes:
    "Reporter sets recursion_limit: 100 in both useCoAgent config and " +
    "TS LangGraphAgent assistantConfig, but LangGraph enforces default 25.\n\n" +
    "Reporter's architecture: Frontend (useCoAgent) → TS LangGraphAgent → LangGraph Platform.\n" +
    "This reproduction uses LangGraphHttpAgent → local Python agent (no Platform available).\n\n" +
    "What we CAN test: useCoAgent config does NOT flow to the Python graph.\n" +
    "What we CANNOT test: TS LangGraphAgent.assistantConfig → LangGraph Platform " +
    "(code path looks correct in mergeConfigs, but needs Platform to verify).",
};

// ---------------------------------------------------------------------------
// Reporter's code (for reference, cannot run without LangGraph Platform):
//
//   // Frontend
//   const { state, setState } = useCoAgent({
//     name: "tp2ts_agent",
//     config: { recursion_limit: 100 },
//   });
//
//   // Server (TS LangGraphAgent — NOT LangGraphHttpAgent)
//   'tp2ts_agent': new LangGraphAgent({
//     deploymentUrl: LANGGRAPH_API_URL,
//     graphId: 'tp2ts_agent',
//     assistantConfig: { recursion_limit: 100 },
//   })
//
// The TS LangGraphAgent forwards assistantConfig via mergeConfigs() →
// client.runs.stream() payload. Code path looks correct but we can't
// verify without a LangGraph Platform deployment.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scenario A: recursion_limit=100 set on the Python agent layer
//   This is the workaround — set the limit where the graph actually runs.
//   → Expected: SUCCEEDS (graph completes all 30 iterations)
// ---------------------------------------------------------------------------

function ScenarioA() {
  console.log("[tkt-recursion-limit] ScenarioA mounted (with_limit agent)");

  return (
    <CopilotKit
      runtimeUrl="/api/tickets/tkt-recursion-limit/copilot"
      agent="with_limit"
    >
      <ScenarioAInner />
    </CopilotKit>
  );
}

function ScenarioAInner() {
  // Reporter also sets this on frontend — include it to match their pattern,
  // but in this scenario the Python-side config is what actually works.
  const { state, running } = useCoAgent<{
    counter: number;
    target: number;
    status: string;
  }>({
    name: "with_limit",
    initialState: { counter: 0, target: 30, status: "idle" },
    config: {
      recursion_limit: 100,
    },
  });

  useEffect(() => {
    console.log("[tkt-recursion-limit] ScenarioA state update:", {
      counter: state?.counter,
      target: state?.target,
      status: state?.status,
      running,
    });
  }, [state?.counter, state?.status, running]);

  return (
    <div className="flex flex-col h-[600px]">
      <div className="p-4 bg-green-50 border-b border-green-200">
        <h3 className="font-semibold text-green-800 mb-1">
          Scenario A: recursion_limit=100 on Python agent config
        </h3>
        <p className="text-sm text-green-700">
          Python agent has <code className="bg-green-100 px-1 rounded">config={`{"recursion_limit": 100}`}</code>.
          Frontend also passes it via useCoAgent (matching reporter's pattern).
          Graph loops 30 times. <strong>Expected: succeeds.</strong>
        </p>
        <p className="text-xs text-green-600 mt-1">
          Workaround: set recursion_limit where the graph actually executes.
        </p>
        <div className="mt-2 text-xs text-green-600 font-mono">
          counter: {state?.counter ?? "?"} / {state?.target ?? "?"} | status: {state?.status ?? "?"} | running: {String(running)}
        </div>
      </div>
      <div className="flex-1 relative">
        <CopilotChat
          labels={{
            modalHeaderTitle: "Scenario A (Python-side limit)",
            welcomeMessageText:
              'Say anything to trigger the agent. It loops 30 times and should succeed.',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario B: recursion_limit=100 ONLY on frontend (reporter's bug)
//   This mirrors what the reporter is doing — useCoAgent config with
//   recursion_limit: 100. The Python agent has no limit config.
//   → Expected: FAILS at 25 (default LangGraph recursion limit)
//
//   NOTE: The reporter ALSO sets assistantConfig on the TS LangGraphAgent,
//   which we cannot test here (requires LangGraph Platform). We can only
//   demonstrate the useCoAgent config path failing.
// ---------------------------------------------------------------------------

function ScenarioB() {
  console.log("[tkt-recursion-limit] ScenarioB mounted (without_limit agent)");

  return (
    <CopilotKit
      runtimeUrl="/api/tickets/tkt-recursion-limit/copilot"
      agent="without_limit"
    >
      <ScenarioBInner />
    </CopilotKit>
  );
}

function ScenarioBInner() {
  // Matches reporter's exact pattern:
  //   const { state, setState } = useCoAgent({
  //     name: "tp2ts_agent",
  //     config: { recursion_limit: 100 },
  //   })
  const { state, running } = useCoAgent<{
    counter: number;
    target: number;
    status: string;
  }>({
    name: "without_limit",
    initialState: { counter: 0, target: 30, status: "idle" },
    config: {
      recursion_limit: 100,
    },
  });

  useEffect(() => {
    console.log("[tkt-recursion-limit] ScenarioB state update:", {
      counter: state?.counter,
      target: state?.target,
      status: state?.status,
      running,
    });
  }, [state?.counter, state?.status, running]);

  return (
    <div className="flex flex-col h-[600px]">
      <div className="p-4 bg-red-50 border-b border-red-200">
        <h3 className="font-semibold text-red-800 mb-1">
          Scenario B: recursion_limit=100 only via useCoAgent config (frontend)
        </h3>
        <p className="text-sm text-red-700">
          Python agent has <strong>no</strong> recursion_limit config.
          Frontend passes <code className="bg-red-100 px-1 rounded">config: {`{ recursion_limit: 100 }`}</code> via
          useCoAgent (matching reporter's pattern). Graph loops 30 times.{" "}
          <strong>Expected: fails at step 25.</strong>
        </p>
        <p className="text-xs text-red-600 mt-1">
          useCoAgent config goes through copilotkit.setProperties() but never reaches
          the Python graph's astream_events() call.
          Reporter also sets assistantConfig on the TS LangGraphAgent — that code path
          (mergeConfigs → client.runs.stream) looks correct but cannot be tested without
          LangGraph Platform.
        </p>
        <div className="mt-2 text-xs text-red-600 font-mono">
          counter: {state?.counter ?? "?"} / {state?.target ?? "?"} | status: {state?.status ?? "?"} | running: {String(running)}
        </div>
      </div>
      <div className="flex-1 relative">
        <CopilotChat
          labels={{
            modalHeaderTitle: "Scenario B (frontend-only limit)",
            welcomeMessageText:
              'Say anything to trigger the agent. It loops 30 times but should FAIL at step 25.',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ticket — toggle between scenarios (one at a time for clean logs)
// ---------------------------------------------------------------------------

export default function TktRecursionLimit() {
  const [activeScenario, setActiveScenario] = useState<"A" | "B" | null>(null);

  console.log("[tkt-recursion-limit] Active scenario:", activeScenario);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-2">
        recursion_limit=100 ignored, default 25 enforced
      </h2>
      <p className="text-sm text-gray-600 mb-2">
        A LangGraph graph that loops 30 times (exceeding the default limit of 25).
        Reporter uses TS <code>LangGraphAgent</code> → LangGraph Platform.
        This reproduction uses <code>LangGraphHttpAgent</code> → local Python agent.
      </p>
      <div className="text-sm text-gray-500 mb-4 space-y-1">
        <p>
          <strong>Scenario A (workaround):</strong> <code>recursion_limit=100</code> set on
          the Python agent config — succeeds.
        </p>
        <p>
          <strong>Scenario B (reporter's bug):</strong> <code>recursion_limit=100</code> only
          via <code>useCoAgent</code> config — fails at 25.
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Cannot test: TS LangGraphAgent.assistantConfig → LangGraph Platform
          (requires Platform deployment). The mergeConfigs() code path looks correct
          but may have an issue at the Platform API level.
        </p>
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setActiveScenario(activeScenario === "A" ? null : "A")}
          className={`rounded-lg px-4 py-2 text-sm font-medium border ${
            activeScenario === "A"
              ? "bg-green-600 text-white border-green-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Scenario A: Python-side limit (works)
        </button>
        <button
          onClick={() => setActiveScenario(activeScenario === "B" ? null : "B")}
          className={`rounded-lg px-4 py-2 text-sm font-medium border ${
            activeScenario === "B"
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Scenario B: Frontend-only limit (fails)
        </button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {activeScenario === "A" && <ScenarioA />}
        {activeScenario === "B" && <ScenarioB />}
        {activeScenario === null && (
          <div className="p-12 text-center text-gray-400 text-sm">
            Select a scenario above to start. Check browser console and terminal
            for <code>[tkt-recursion-limit]</code> logs.
          </div>
        )}
      </div>
    </div>
  );
}
