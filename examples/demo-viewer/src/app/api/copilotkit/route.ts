import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

import { NextRequest } from "next/server";

const serviceAdapter = new OpenAIAdapter();


export const POST = async (req: NextRequest) => {
  let runtime
  if (req.url.endsWith("?standard=true")) {
    console.log("standard")
    runtime = new CopilotRuntime();
  }
  else{
    runtime = new CopilotRuntime({
      remoteEndpoints: [
        {
          url: process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
        },
      ],
    });
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
