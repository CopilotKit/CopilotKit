import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

const agentBaseUrl = process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8000";

const agent = new LangGraphHttpAgent({
  url: `${agentBaseUrl}/tickets/tkt-example`,
});

const runtime = new CopilotRuntime({
  agents: {
    my_agent: agent,
  },
});

export const handler = copilotRuntimeNodeHttpEndpoint({
  runtime,
  serviceAdapter: new ExperimentalEmptyAdapter(),
  endpoint: "/api/tickets/tkt-example/copilot",
});
