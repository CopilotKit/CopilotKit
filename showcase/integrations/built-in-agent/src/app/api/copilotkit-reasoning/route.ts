import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import {
  createAgenticChatReasoningAgent,
  createReasoningDefaultRenderAgent,
  createToolRenderingReasoningChainAgent,
} from "@/lib/factory/reasoning-factory";

// Shared runtime for the three reasoning demos. The default tanstack
// factory uses a non-reasoning model (gpt-4o) — these demos need a
// reasoning-capable variant so REASONING_* events flow. They live on
// their own basePath so a single page only spins up the reasoning model
// when actually viewing a reasoning demo.
const runtime = new CopilotRuntime({
  agents: {
    "agentic-chat-reasoning": createAgenticChatReasoningAgent(),
    "reasoning-default-render": createReasoningDefaultRenderAgent(),
    "tool-rendering-reasoning-chain": createToolRenderingReasoningChainAgent(),
  },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-reasoning",
  mode: "single-route",
});

async function withProbeCompat(req: Request): Promise<Response> {
  const res = await handler(req);
  if (res.status === 404) {
    const body = await res.text();
    return new Response(body, { status: 400, headers: res.headers });
  }
  return res;
}

export const GET = (req: Request) => handler(req);
export const POST = (req: Request) => withProbeCompat(req);
export const OPTIONS = (req: Request) => handler(req);
