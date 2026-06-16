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
import { createAgentAliases } from "@/lib/factory/agent-aliases";
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";

// Compatibility runtime for older built-in-agent reasoning URLs. Current
// pages use /api/copilotkit, but keeping this endpoint avoids breaking direct
// links and historical tests.
const runtime = new CopilotRuntime({
  agents: {
    ...createAgentAliases(
      ["agentic-chat-reasoning", "reasoning-custom"],
      createAgenticChatReasoningAgent,
    ),
    ...createAgentAliases(
      ["reasoning-default-render", "reasoning-default"],
      createReasoningDefaultRenderAgent,
    ),
    ...createAgentAliases(
      ["tool-rendering-reasoning-chain"],
      createToolRenderingReasoningChainAgent,
    ),
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

export const GET = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
export const POST = (req: Request) =>
  withForwardedHeaders(req, () => withProbeCompat(req));
export const OPTIONS = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
