import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: { recovery: new HttpAgent({ url: "http://localhost:8000/recovery" }) },
  a2ui: { injectA2UITool: true },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit-recovery",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime,
  });
  return await handleRequest(req);
};
