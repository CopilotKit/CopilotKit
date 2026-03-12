import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

const agentBaseUrl = process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8000";

console.log("[tkt-useagent-hitl server] Initializing with agent URL:", `${agentBaseUrl}/tickets/tkt-useagent-hitl`);

const agent = new LangGraphHttpAgent({
  url: `${agentBaseUrl}/tickets/tkt-useagent-hitl`,
});

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
});

export const handler = copilotRuntimeNodeHttpEndpoint({
  runtime,
  serviceAdapter: new ExperimentalEmptyAdapter(),
  endpoint: "/api/tickets/tkt-useagent-hitl/copilot",
});
