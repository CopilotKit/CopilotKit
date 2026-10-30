import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createPlaygroundAgent } from "@/agent/agent";
import { agentRouteHooks } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const copilotRuntime = new CopilotRuntime({
  agents: { default: createPlaygroundAgent() },
  // The playground agent writes its own Gen UI 2.0 surfaces (A2UI v1.0
  // `generative-ui-surface` activities) from its fixed `show_*` tools and its
  // `generate_a2ui` composer, so the runtime must not inject a `render_ui`
  // tool. The browser still sends the catalog in the generative UI envelope,
  // and the composer reads it from there.
  generativeUI: false,
});

/** Listing and clearing threads answer 403 as they are: the runtime has no `identifyUser`. */
const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
  hooks: agentRouteHooks(
    "This chat is too long to send. Open the playground in a new tab to start over.",
  ),
});

export const GET = handler;
export const POST = handler;
