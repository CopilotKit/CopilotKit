import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createOguiAgent } from "@/lib/factory/ogui-factory";

// Dedicated runtime for the Open Generative UI demo.
//
// Isolated because the `openGenerativeUI` runtime flag advertises
// `openGenerativeUIEnabled: true` on the probe, which causes the
// CopilotKit provider's setTools effect to behave differently from the
// default tools-only runtime. Keeping it on its own basePath avoids
// cross-talk with other demos.
//
// Server-side config is identical for the minimal and advanced cells —
// the advanced behaviour (sandbox -> host function calls) is wired
// entirely on the frontend via `openGenerativeUI.sandboxFunctions` on
// the provider. The single `openGenerativeUI` flag below turns on
// Open Generative UI for the listed agent(s).
// @region[minimal-runtime-flag]
// @region[advanced-runtime-config]
const runtime = new CopilotRuntime({
  agents: { default: createOguiAgent() },
  runner: new InMemoryAgentRunner(),
  openGenerativeUI: {
    agents: ["default"],
  },
});
// @endregion[advanced-runtime-config]
// @endregion[minimal-runtime-flag]

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-ogui",
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
