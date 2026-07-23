import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
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
  agents: { default: createBuiltInAgent() },
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
