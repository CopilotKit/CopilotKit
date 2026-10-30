import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { CopilotRuntime, LangGraphHttpAgent } from "@copilotkit/runtime";

export const runtime = new CopilotRuntime({
  agents: {
    graph: new LangGraphAgent({ deploymentUrl: "http://localhost:8123", graphId: "agent" }),
    http: new LangGraphHttpAgent({ url: "http://localhost:8000" }),
  },
});
