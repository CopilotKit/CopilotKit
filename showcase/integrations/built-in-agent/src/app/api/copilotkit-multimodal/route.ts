// Dedicated runtime for the Multimodal Attachments demo.
//
// Uses the multimodal built-in-agent variant: images flow through
// `convertInputToTanStackAI` and are consumed natively by the vision adapter,
// while PDF `document` parts (which the OpenAI text adapter cannot consume) are
// flattened to text server-side with `unpdf` before the model call — parity
// with LGP's `pypdf` flatten.

import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createMultimodalAgent } from "@/lib/factory/multimodal-factory";
// @doc-replace
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";
// @doc-as
// @doc-end

const runtime = new CopilotRuntime({
  agents: { "multimodal-demo": createMultimodalAgent() },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-multimodal",
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
