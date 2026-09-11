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
// @doc-replace
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";
// @doc-as
// @doc-end

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

// @doc-replace
async function withProbeCompat(req: Request): Promise<Response> {
  const res = await handler(req);
  if (res.status === 404) {
    const body = await res.text();
    return new Response(body, { status: 400, headers: res.headers });
  }
  return res;
}
// @doc-as
// @doc-end

// @doc-replace
export const GET = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
export const POST = (req: Request) =>
  withForwardedHeaders(req, () => withProbeCompat(req));
export const OPTIONS = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
// @doc-as
// export const GET = (req: Request) => handler(req);
// export const POST = (req: Request) => handler(req);
// export const OPTIONS = (req: Request) => handler(req);
// @doc-end
