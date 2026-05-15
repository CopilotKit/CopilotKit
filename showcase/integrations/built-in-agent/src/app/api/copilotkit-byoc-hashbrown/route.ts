// Dedicated runtime for the BYOC hashbrown demo.
//
// Built-in-agent factory with a sales-dashboard system prompt and OpenAI
// `response_format: { type: "json_object" }` so the model can only emit a
// single JSON object — exactly what the hashbrown `useJsonParser` consumes.

import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createByocHashbrownAgent } from "@/lib/factory/byoc-hashbrown-factory";

const runtime = new CopilotRuntime({
  agents: { default: createByocHashbrownAgent() },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-byoc-hashbrown",
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
