import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createA2UIRecoveryAgent } from "@/lib/factory/a2ui-factory";
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";

// Dedicated runtime for the A2UI Error Recovery demo.
//
// Reuses the declarative-gen-ui agent + catalog (per the LGP reference, whose
// recovery_agent reuses the declarative-gen-ui catalog) but with the OPT-IN
// recovery variant: `generate_a2ui` runs a validate->retry loop and, once the
// attempt cap is hit with only invalid surfaces, returns the
// `a2ui_recovery_exhausted` envelope the A2UI middleware paints as a graceful
// failure card. `injectA2UITool: false` — the factory owns the tool.
const runtime = new CopilotRuntime({
  agents: { "a2ui-recovery": createA2UIRecoveryAgent() },
  runner: new InMemoryAgentRunner(),
  a2ui: {
    injectA2UITool: false,
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit-a2ui-recovery",
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
