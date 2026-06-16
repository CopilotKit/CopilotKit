// Dedicated runtime for the declarative-hashbrown demo.
//
// The backend implementation uses the built-in hashbrown factory that emits
// the structured shape consumed by the HashBrown renderer.

import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createAgentAliases } from "@/lib/factory/agent-aliases";
import { createByocHashbrownAgent } from "@/lib/factory/byoc-hashbrown-factory";
import { withForwardedHeaders } from "@/lib/header-forwarding";

// @region[declarative-hashbrown-runtime]
const runtime = new CopilotRuntime({
  agents: createAgentAliases(
    ["default", "declarative-hashbrown-demo"],
    createByocHashbrownAgent,
  ),
  runner: new InMemoryAgentRunner(),
});
// @endregion[declarative-hashbrown-runtime]

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-declarative-hashbrown",
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
