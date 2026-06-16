// Dedicated runtime for the Multimodal Attachments demo.
//
// Reuses the base built-in-agent factory. AG-UI image / document parts flow through
// `convertInputToTanStackAI` natively; no agent-side rewrite is required.

import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
import { createAgentAliases } from "@/lib/factory/agent-aliases";
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";

const runtime = new CopilotRuntime({
  agents: createAgentAliases(
    ["default", "multimodal-demo"],
    createBuiltInAgent,
  ),
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-multimodal",
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
