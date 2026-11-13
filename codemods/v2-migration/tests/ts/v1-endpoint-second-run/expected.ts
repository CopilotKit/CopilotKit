import {
  CopilotKitRuntime,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@ag-ui/langgraph";
import type { NextRequest } from "next/server";
import { openaiText } from "@tanstack/ai-openai";
import { BuiltInAgent } from "@copilotkit/runtime/agent";

const runtime = new CopilotKitRuntime({
  agents: {
    default: new BuiltInAgent({ model: openaiText("gpt-5") }),
    sample_agent: new LangGraphAgent({
      deploymentUrl: "http://localhost:8123",
      graphId: "sample_agent",
    }),
  },
});

export const POST = async (req: NextRequest) => {
  const handleRequest = createCopilotKitRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
  });

  return handleRequest(req);
};

// Only agents: the empty adapter adds nothing.
export async function PUT(req: NextRequest) {
  const handle = createCopilotKitRuntimeHandler({
    runtime: new CopilotKitRuntime({ agents: {} }),
    basePath: req.nextUrl.pathname,
    mode: "single-route",
  });
  return handle(req);
}
