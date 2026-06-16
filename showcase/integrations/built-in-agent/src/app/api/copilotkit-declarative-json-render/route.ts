// Dedicated runtime for the declarative-json-render demo.
//
// The frontend uses the `byoc_json_render` agent ID; this route binds that ID
// to the built-in structured-output factory.

import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createAgentAliases } from "@/lib/factory/agent-aliases";
import { createByocJsonRenderAgent } from "@/lib/factory/byoc-json-render-factory";
import { withForwardedHeaders } from "@/lib/header-forwarding";

// @region[declarative-json-render-runtime]
const runtime = new CopilotRuntime({
  agents: createAgentAliases(
    ["default", "byoc_json_render"],
    createByocJsonRenderAgent,
  ),
  runner: new InMemoryAgentRunner(),
});
// @endregion[declarative-json-render-runtime]

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-declarative-json-render",
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
