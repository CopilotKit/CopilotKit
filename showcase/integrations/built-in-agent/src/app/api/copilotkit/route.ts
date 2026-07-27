import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
import { createAgenticChatAgent } from "@/lib/factory/agentic-chat-factory";
import {
  createAgenticChatReasoningAgent,
  createReasoningDefaultRenderAgent,
  createToolRenderingReasoningChainAgent,
} from "@/lib/factory/reasoning-factory";
// `withForwardedHeaders` snapshots inbound x-* headers (e.g.
// x-aimock-context) into an AsyncLocalStorage scope so the wrapped
// OpenAI client's custom fetch can re-attach them on every outbound
// LLM call. Required because `@tanstack/ai-openai`'s `openaiText()`
// adapter has no per-request header hook of its own.
import { withForwardedHeaders } from "@/lib/header-forwarding";
// CVDIAG backend instrumentation (L1-E). No-op pass-through unless
// CVDIAG_BACKEND_EMITTER is set truthy (default OFF).
import { withCvdiagBackend } from "@/cvdiag-backend";

const runtime = new CopilotRuntime({
  agents: {
    // Catch-all agent retained during the LGP-parity migration.
    default: createBuiltInAgent(),

    // Per-demo named agents resolved by the byte-identical LGP frontends via
    // `agent="<id>"` on `/api/copilotkit`. The generic `createBuiltInAgent()`
    // carries the full server/state/subagent tool surface; per-demo behavior
    // is driven by the aimock fixture (same contract the old `default`-routed
    // demos relied on), so the chat-UI / tool / state / HITL / gen-UI demos
    // share it. Reasoning demos use the reasoning adapter factory.
    agentic_chat: createAgenticChatAgent(),

    "chat-customization-css": createBuiltInAgent(),
    "chat-slots": createBuiltInAgent(),
    "prebuilt-popup": createBuiltInAgent(),
    "prebuilt-sidebar": createBuiltInAgent(),
    "headless-simple": createBuiltInAgent(),

    frontend_tools: createBuiltInAgent(),
    "frontend-tools-async": createBuiltInAgent(),

    "tool-rendering": createBuiltInAgent(),
    "tool-rendering-default-catchall": createBuiltInAgent(),
    "tool-rendering-custom-catchall": createBuiltInAgent(),

    "gen-ui-agent": createBuiltInAgent(),
    "gen-ui-tool-based": createBuiltInAgent(),
    "gen-ui-interrupt": createBuiltInAgent(),
    "interrupt-headless": createBuiltInAgent(),

    human_in_the_loop: createBuiltInAgent(),
    "hitl-in-chat": createBuiltInAgent(),
    "hitl-in-app": createBuiltInAgent(),

    "shared-state-read": createBuiltInAgent(),
    "shared-state-read-write": createBuiltInAgent(),
    "shared-state-streaming": createBuiltInAgent(),
    "readonly-state-agent-context": createBuiltInAgent(),

    subagents: createBuiltInAgent(),
    "threadid-frontend-tool-roundtrip": createBuiltInAgent(),

    // Reasoning demos — visible chain-of-thought via the reasoning adapter.
    "reasoning-custom": createAgenticChatReasoningAgent(),
    "reasoning-default": createReasoningDefaultRenderAgent(),
    "tool-rendering-reasoning-chain": createToolRenderingReasoningChainAgent(),
  },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
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

const copilotkitPost = async (req: Request): Promise<Response> =>
  withForwardedHeaders(req, () => withProbeCompat(req));

export const GET = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
// Wrap POST with CVDIAG backend instrumentation (L1-E). built-in-agent runs
// its BuiltInAgent in-process inside this route handler. No-op pass-through
// unless CVDIAG_BACKEND_EMITTER is set truthy (default OFF).
export const POST = withCvdiagBackend(copilotkitPost, {
  slug: "built-in-agent",
  agentName: "default",
  provider: "openai",
});
export const OPTIONS = (req: Request) =>
  withForwardedHeaders(req, () => handler(req));
