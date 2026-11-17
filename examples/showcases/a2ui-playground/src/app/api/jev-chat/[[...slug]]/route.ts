import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { agentRouteHooks } from "@/lib/limits";
import { createJevChatAgent } from "@/jev/chat-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const copilotRuntime = new CopilotRuntime({
  agents: { jev: createJevChatAgent() },
});
const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/jev-chat",
  hooks: agentRouteHooks(),
});

export const GET = handler;
export const POST = handler;
