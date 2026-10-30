// Minimal path (no custom agent): a stock BuiltInAgent. Passing `generativeUI={{ ui }}`
// on the provider sends the catalog with every run, and the runtime injects the
// Gen UI 2.0 `render_ui` tool (A2UI v1.0 operations) and its guide automatically.
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { agentRouteHooks } from "@/lib/limits";

export const runtime = "nodejs";

const copilotRuntime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai:gpt-5.5",
      prompt:
        "Answer with UI: call render_ui with A2UI v1.0 operations built from the components in the generative UI guide.",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/minimal",
  hooks: agentRouteHooks(),
});
export const GET = handler;
export const POST = handler;
