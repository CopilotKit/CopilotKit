// ---------------------------------------------------------------------------
// tkt-reconnect-lost-actions: Frontend actions lost on thread reconnect
//
// Bug: langchain_messages_to_copilotkit() in copilotkit/langgraph.py skips
// creating the assistant message when AIMessage has tool_calls. The
// parentMessageId references a message that never existed in the output.
//
// Slack: https://functionhealth.slack.com/archives/C09C4HRL8F9/p1769635454992139
// ---------------------------------------------------------------------------

import { CopilotRuntime } from "@copilotkitnext/runtime";
import { createCopilotEndpointSingleRoute } from "@copilotkitnext/runtime";
import { HttpAgent } from "@ag-ui/client";

const TAG = "[tkt-reconnect-lost-actions server]";

const agentBaseUrl =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8000";
const agentUrl = `${agentBaseUrl}/tickets/tkt-reconnect-lost-actions`;

console.log(TAG, "Agent URL:", agentUrl);

const agent = new HttpAgent({ url: agentUrl });

const runtime = new CopilotRuntime({
  agents: { default: agent },
});

const app = createCopilotEndpointSingleRoute({
  runtime,
  basePath: "/",
});

console.log(TAG, "Endpoint ready at /api/tickets/tkt-reconnect-lost-actions/copilot");

export const handler = (request: Request) => {
  const url = new URL(request.url);
  console.log(TAG, "Incoming:", request.method, url.pathname);
  url.pathname = "/";
  return app.fetch(new Request(url, request));
};
