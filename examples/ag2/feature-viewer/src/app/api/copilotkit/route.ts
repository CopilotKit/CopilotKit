import { HttpAgent } from "@ag-ui/client";

import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

import { NextRequest } from "next/server";

const AGENTIC_CHAT_AGENT_URL = process.env.AGENTIC_CHAT_AGENT_URL;
const HUMAN_IN_THE_LOOP_AGENT_URL = process.env.HUMAN_IN_THE_LOOP_AGENT_URL;

const agenticChatAgent = new HttpAgent({
  url: AGENTIC_CHAT_AGENT_URL!, // "https://copilotkit-dojo.ag2.ai:8000/fastagency/awp",
});

const humanInTheLoopAgent = new HttpAgent({
  url: HUMAN_IN_THE_LOOP_AGENT_URL!, // "https://copilotkit-dojo.ag2.ai:8008/fastagency/awp",
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
