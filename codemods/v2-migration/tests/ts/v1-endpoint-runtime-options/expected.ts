import type { NextRequest } from "next/server";
import {
  CopilotKitRuntime,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotKitRuntime({
  agents: { recovery: new HttpAgent({ url: "http://localhost:8000/recovery" }) },
  generativeUI: { a2uiVersion: "0.9", injectA2UITool: true },
});

export const POST = async (req: NextRequest) => {
  const handleRequest = createCopilotKitRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit-recovery",
    mode: "single-route",
  });
  return await handleRequest(req);
};
