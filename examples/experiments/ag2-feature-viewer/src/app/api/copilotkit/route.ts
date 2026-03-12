import { HttpAgent } from "@ag-ui/client";

import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

import { NextRequest } from "next/server";

const BASE_URL = "http://localhost:3000";

const agenticChatAgent = new HttpAgent({
  url: "https://copilotkit-dojo.ag2.ai:8000/fastagency/awp",
});

const humanInTheLoopAgent = new HttpAgent({
  url: "https://copilotkit-dojo.ag2.ai:8008/fastagency/awp",
});

const runtime = new CopilotRuntime({
  agents: {
    agenticChatAgent,
    humanInTheLoopAgent,
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
