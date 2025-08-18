import { NextRequest } from "next/server";
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { getServiceAdapter } from "../../../lib/dynamic-service-adapter";
import { MastraAgent } from "@ag-ui/mastra";
import { MastraClient } from "@mastra/client-js";

const UNSPLASH_ACCESS_KEY_ENV = "UNSPLASH_ACCESS_KEY";
const UNSPLASH_ACCESS_KEY = process.env[UNSPLASH_ACCESS_KEY_ENV];

export const POST = async (req: NextRequest) => {
  const mastraClient = new MastraClient({
    baseUrl: "http://localhost:4111",
  });

  const agents = await MastraAgent.getRemoteAgents({ mastraClient });

  const runtime = new CopilotRuntime({
    // @ts-expect-error
    agents,
  });

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
