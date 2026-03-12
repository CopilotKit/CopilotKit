import { useState } from "react";
import type { TicketMeta } from "@/lib/ticket-types";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title: "Sub agents within an agent is not working (Mastra)",
  refs: ["https://github.com/CopilotKit/CopilotKit/issues/2732"],
  notes:
    "Root cause: @ag-ui/mastra's MastraAgent always calls agent.stream(), never " +
    "agent.network(). In Mastra, .stream() doesn't expose sub-agents to the LLM. " +
    "Only .network() activates routing to sub-agents.\n\n" +
    "The Mastra playground works because it calls .network() directly. " +
    "CopilotKit goes through AG-UI → MastraAgent → .stream() → sub-agents invisible.\n\n" +
    "Relevant code: @ag-ui/mastra/dist/index.mjs — streamMastraAgent() method, " +
    "line `let p = await this.agent.stream(x, ...)` — should conditionally call " +
    ".network() when the agent has sub-agents configured.",
};

// ---------------------------------------------------------------------------
// Example A: Email agent (with weather sub-agent) — BROKEN
//
// The email agent has weatherAgent as a sub-agent. When asked to draft
// a weather-related email, it should delegate to the weather agent.
// Instead, it says it doesn't have access to sub-agents.
// ---------------------------------------------------------------------------

function ExampleA_EmailAgent() {
  console.log("[tkt-2732] ExampleA (emailAgent with sub-agent) mounted");

  return (
    <CopilotKit runtimeUrl="/api/tickets/tkt-2732/copilot" agent="emailAgent">
      <ExampleA_Inner />
    </CopilotKit>
  );
}

function ExampleA_Inner() {
  return (
    <div className="h-[600px] flex flex-col">
      <div className="p-3 bg-red-50 border-b border-red-200 text-sm">
        <strong>Email Agent</strong> (locked via <code>agent="emailAgent"</code>)
        <br />
        <span className="text-gray-600">
          Has weatherAgent as sub-agent. Ask: "Draft an email about the weather in Paris."
        </span>
        <br />
        <span className="text-red-600 font-medium">
          BUG: Agent says it can't access sub-agents because CopilotKit calls .stream() instead of
          .network().
        </span>
      </div>
      <div className="flex-1">
        <CopilotChat
          defaultOpen={true}
          labels={{
            modalHeaderTitle: "Email Agent (sub-agent broken)",
            welcomeMessageText:
              "I'm the email agent. I should be able to use the weather agent, " +
              "but CopilotKit calls .stream() instead of .network(), so I can't " +
              "access my sub-agents. Try asking me to draft a weather email!",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Example B: Weather agent directly — WORKS
//
// The weather agent is used directly (no sub-agent indirection).
// This works fine because the agent has its own tools.
// ---------------------------------------------------------------------------

function ExampleB_WeatherAgent() {
  console.log("[tkt-2732] ExampleB (weatherAgent direct) mounted");

  return (
    <CopilotKit runtimeUrl="/api/tickets/tkt-2732/copilot" agent="weatherAgent">
      <ExampleB_Inner />
    </CopilotKit>
  );
}

function ExampleB_Inner() {
  return (
    <div className="h-[600px] flex flex-col">
      <div className="p-3 bg-green-50 border-b border-green-200 text-sm">
        <strong>Weather Agent</strong> (locked via <code>agent="weatherAgent"</code>)
        <br />
        <span className="text-gray-600">
          Standalone agent with weather tool. Ask: "What's the weather in Paris?"
        </span>
        <br />
        <span className="text-green-600 font-medium">
          WORKS: Direct agent with tools works fine through CopilotKit.
        </span>
      </div>
      <div className="flex-1">
        <CopilotChat
          defaultOpen={true}
          labels={{
            modalHeaderTitle: "Weather Agent (works)",
            welcomeMessageText:
              "I'm the weather agent. I have the get-weather tool and can " +
              "get weather data directly. Try asking about any city's weather!",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — toggle between examples (one at a time for clean logs)
// ---------------------------------------------------------------------------

export default function Tkt2732() {
  const [activeExample, setActiveExample] = useState<"A" | "B" | null>(null);

  console.log("[tkt-2732] Active example:", activeExample);

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="text-lg font-bold mb-1">
          #2732: Sub agents within an agent not working (Mastra)
        </h2>
        <p className="text-sm text-gray-600 mb-3">
          Email agent has weather agent as sub-agent. Through CopilotKit, the email agent can't
          delegate to the weather agent. The standalone weather agent works fine.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setActiveExample(activeExample === "A" ? null : "A")}
            className={`rounded-lg px-4 py-2 text-sm font-medium border ${
              activeExample === "A"
                ? "bg-red-600 text-white border-red-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            A: Email Agent with sub-agent (broken)
          </button>
          <button
            onClick={() => setActiveExample(activeExample === "B" ? null : "B")}
            className={`rounded-lg px-4 py-2 text-sm font-medium border ${
              activeExample === "B"
                ? "bg-green-600 text-white border-green-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            B: Weather Agent direct (works)
          </button>
        </div>
      </div>

      <div className="flex-1">
        {activeExample === "A" && <ExampleA_EmailAgent />}
        {activeExample === "B" && <ExampleB_WeatherAgent />}
        {activeExample === null && (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Select an example above to start. Check browser console and server logs for [tkt-2732]
            prefixed output.
          </div>
        )}
      </div>
    </div>
  );
}
