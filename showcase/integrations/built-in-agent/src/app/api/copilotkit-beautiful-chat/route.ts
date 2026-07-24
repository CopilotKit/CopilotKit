import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";

// Dedicated runtime for the Beautiful Chat starter demo. The generic
// all-tools agent backs it (the polished two-pane chat + gen-UI chart
// examples ride the shared server tools); per-demo behavior is driven by
// the aimock fixture. Matches the LGP reference route/agent id.
const runtime = new CopilotRuntime({
  agents: { "beautiful-chat": createBuiltInAgent() },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-beautiful-chat",
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
