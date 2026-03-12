import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

// ---------------------------------------------------------------------------
// ARCHITECTURE NOTE
//
// Reporter's setup (cannot reproduce locally — requires LangGraph Platform):
//
//   import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
//
//   'tp2ts_agent': new LangGraphAgent({
//     deploymentUrl: LANGGRAPH_API_URL,
//     graphId: 'tp2ts_agent',
//     langsmithApiKey: process.env.LANGSMITH_API_KEY,
//     assistantConfig: {
//       recursion_limit: 100,    // <-- forwarded via mergeConfigs → client.runs.stream()
//     },
//   })
//
// The TS LangGraphAgent connects to LangGraph Platform via @langchain/langgraph-sdk.
// assistantConfig is merged with the Platform assistant's config in mergeConfigs()
// and sent as payload.config to client.runs.stream(). The code path looks correct
// but cannot be verified without a Platform deployment.
//
// This reproduction uses LangGraphHttpAgent (direct HTTP POST to a local Python agent)
// to demonstrate that useCoAgent({ config: { recursion_limit: 100 } }) does NOT
// forward the limit to the graph execution layer.
// ---------------------------------------------------------------------------

const agentBaseUrl =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Scenario A: Python agent has config={"recursion_limit": 100}
// ---------------------------------------------------------------------------

const agentWithLimit = new LangGraphHttpAgent({
  url: `${agentBaseUrl}/tickets/tkt-recursion-limit/with-limit`,
});

console.log(
  "[tkt-recursion-limit server] Scenario A (with_limit) URL:",
  `${agentBaseUrl}/tickets/tkt-recursion-limit/with-limit`
);

// ---------------------------------------------------------------------------
// Scenario B: Python agent has NO recursion_limit (default 25)
// ---------------------------------------------------------------------------

const agentWithoutLimit = new LangGraphHttpAgent({
  url: `${agentBaseUrl}/tickets/tkt-recursion-limit/without-limit`,
});

console.log(
  "[tkt-recursion-limit server] Scenario B (without_limit) URL:",
  `${agentBaseUrl}/tickets/tkt-recursion-limit/without-limit`
);

// ---------------------------------------------------------------------------
// Single runtime with both agents — frontend selects via CopilotKit agent prop
// ---------------------------------------------------------------------------

const runtime = new CopilotRuntime({
  agents: {
    with_limit: agentWithLimit,
    without_limit: agentWithoutLimit,
  },
});

export const handler = copilotRuntimeNodeHttpEndpoint({
  runtime,
  serviceAdapter: new ExperimentalEmptyAdapter(),
  endpoint: "/api/tickets/tkt-recursion-limit/copilot",
});
