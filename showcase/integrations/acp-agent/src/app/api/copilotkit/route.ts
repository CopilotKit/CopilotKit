import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import type { NextRequest } from "next/server";
import { createAcpRuntime } from "@/lib/acp-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let runtimeHandler: ReturnType<typeof createCopilotRuntimeHandler> | undefined;

const handleRequest = (request: NextRequest): Promise<Response> => {
  runtimeHandler ??= createCopilotRuntimeHandler({
    basePath: "/api/copilotkit",
    mode: "single-route",
    runtime: createAcpRuntime(),
  });
  return runtimeHandler(request);
};

export const GET = handleRequest;
export const POST = handleRequest;
export const OPTIONS = handleRequest;
