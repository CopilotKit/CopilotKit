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
    runtime = new CopilotRuntime();
  }
  else if (req.url.endsWith("?langgraph=true")) {
    runtime = new CopilotRuntime({
      remoteEndpoints: [
        {
          url: process.env.REMOTE_ACTION_URL || process.env.REMOTE_ACTION_URL_LANGGRAPH || "http://localhost:8000/copilotkit",
        },
      ],
    });
  }
  else if (req.url.endsWith("?crewai=true")) {
    runtime = new CopilotRuntime({
      remoteEndpoints: [
        {
          url: process.env.REMOTE_ACTION_URL || process.env.REMOTE_ACTION_URL_CREWAI || "http://localhost:8000/copilotkit",
        },
      ],
    });
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
