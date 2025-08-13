import { NextRequest } from "next/server";
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { getServiceAdapter } from "../../../lib/dynamic-service-adapter";
import { LangGraphAgent } from "@ag-ui/langgraph";

const UNSPLASH_ACCESS_KEY_ENV = "UNSPLASH_ACCESS_KEY";
const UNSPLASH_ACCESS_KEY = process.env[UNSPLASH_ACCESS_KEY_ENV];

const runtime = new CopilotRuntime({
  agents: {
    // @ts-expect-error
    agentic_chat: new LangGraphAgent({
      deploymentUrl: "http://localhost:2024",
      graphId: "agentic_chat",
    }),
  },
});

export const POST = async (req: NextRequest) => {
  const { searchParams } = req.nextUrl;
  const serviceAdapterQueryParam = searchParams.get("serviceAdapter") || "openai";
  const serviceAdapter = await getServiceAdapter(serviceAdapterQueryParam);

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
