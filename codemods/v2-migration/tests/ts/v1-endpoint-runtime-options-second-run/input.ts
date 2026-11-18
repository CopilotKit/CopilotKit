import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: { recovery: new HttpAgent({ url: "http://localhost:8000/recovery" }) },
  generativeUI: { a2uiVersion: "0.9", injectA2UITool: true },
});

export const POST = async (req: NextRequest) => {
  const handleRequest = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit-recovery",
    mode: "single-route",
  });
  return await handleRequest(req);
};
