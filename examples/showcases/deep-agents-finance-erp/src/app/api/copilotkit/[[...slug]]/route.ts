import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
import { handle } from "hono/vercel";

const runtime = new CopilotRuntime({
  agents: {
    finance_erp_agent: new LangGraphHttpAgent({
      url:
        process.env.REMOTE_ACTION_URL ||
        "http://localhost:8123/copilotkit/agents/finance_erp_agent",
    }),
  },
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
