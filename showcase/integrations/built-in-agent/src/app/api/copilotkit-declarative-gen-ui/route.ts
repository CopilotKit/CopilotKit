import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createDeclarativeGenUIAgent } from "@/lib/factory/a2ui-factory";

// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic
// Schema) demo.
//
// `a2ui.injectA2UITool: false` — the backend factory owns the
// `generate_a2ui` tool itself (see `src/lib/factory/a2ui-factory.ts`), so
// the runtime MUST NOT auto-inject its own A2UI tool on top. The A2UI
// middleware still runs — it serialises the registered client catalog
// schema into the agent's `input.context` so the secondary LLM inside
// `generate_a2ui` knows which components to emit, and it still detects the
// `a2ui_operations` container in the tool result and streams rendered
// surfaces to the frontend.
const runtime = new CopilotRuntime({
  agents: { default: createDeclarativeGenUIAgent() },
  runner: new InMemoryAgentRunner(),
  a2ui: {
    injectA2UITool: false,
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-declarative-gen-ui",
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
