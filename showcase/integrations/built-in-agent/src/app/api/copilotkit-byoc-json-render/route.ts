// Dedicated runtime for the BYOC json-render demo.
//
// Built-in-agent factory with a sales-dashboard system prompt and OpenAI
// `response_format: { type: "json_object" }` so the model emits exactly
// one JSON object — what `<Renderer />` consumes as a flat
// `{ root, elements }` spec.

import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createByocJsonRenderAgent } from "@/lib/factory/byoc-json-render-factory";

const runtime = new CopilotRuntime({
  agents: { default: createByocJsonRenderAgent() },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-byoc-json-render",
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
