import { NextRequest } from "next/server";
import {
  CopilotKitRuntime,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { openaiText } from "@tanstack/ai-openai";
import { BuiltInAgent } from "@copilotkit/runtime/agent";

export const POST = async (req: NextRequest) => {
  const handleRequest = createCopilotKitRuntimeHandler({
    runtime: new CopilotKitRuntime({ agents: { default: new BuiltInAgent({ model: openaiText("gpt-6-luna") }) } }),
    basePath: req.nextUrl.pathname,
    mode: "single-route",
  });

  return handleRequest(req);
};
