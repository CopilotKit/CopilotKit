import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createA2UIFixedSchemaAgent } from "@/lib/factory/a2ui-fixed-schema-factory";

// Dedicated runtime for the A2UI — Fixed Schema demo.
//
// `a2ui.injectA2UITool: false` — the backend factory owns the
// `display_flight` tool which emits its own `a2ui_operations` container
// (see src/lib/factory/a2ui-fixed-schema-factory.ts). The A2UI middleware
// still runs so it detects the container in tool results and forwards the
// rendered surface to the frontend renderer; we just don't want it to also
// inject a runtime `render_a2ui` tool on top of our own.
const runtime = new CopilotRuntime({
  agents: { default: createA2UIFixedSchemaAgent() },
  runner: new InMemoryAgentRunner(),
  a2ui: {
    injectA2UITool: false,
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-a2ui-fixed-schema",
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
