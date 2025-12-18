import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";
import { getServiceAdapter } from "../../../../lib/dynamic-service-adapter";

export const POST = async (req: NextRequest) => {
  const { searchParams } = req.nextUrl;
  const serviceAdapterQueryParam = searchParams.get("serviceAdapter") || "openai";
  const serviceAdapter = await getServiceAdapter(serviceAdapterQueryParam);

  const runtime = new CopilotRuntime();
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
