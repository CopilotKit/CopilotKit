// Reference implementation copied from the a2ui-playground build (working, measured).
// Paths like @/a2ui/... are app-specific: adapt imports to your project.
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createPlaygroundAgent } from "@/agent/agent";

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

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
