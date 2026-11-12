// Minimal path (no custom agent): a stock BuiltInAgent. Passing `generativeUI={{ ui }}`
// on the provider sends the catalog with every run, and the runtime injects the
// Gen UI 2.0 `render_ui` tool (A2UI 1.0 operations) and its guide automatically.
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { openaiText } from "@tanstack/ai-openai";
import { agentRouteHooks } from "@/lib/limits";

export const runtime = "nodejs";

// Built on the first request, not at import: `openaiText` reads OPENAI_API_KEY
// when it is called and throws without it, and `next build` imports every
// route. A deploy without the key still builds; only this route then answers 503.
let handler: ((request: Request) => Promise<Response>) | undefined;
function minimalHandler(): (request: Request) => Promise<Response> {
  if (!process.env.OPENAI_API_KEY)
    return async () =>
      Response.json(
        { error: "/minimal needs OPENAI_API_KEY on the server." },
        { status: 503 },
      );
  handler ??= createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: {
        default: new BuiltInAgent({
          model: openaiText("gpt-5.5"),
          prompt:
            "Answer with UI: call render_ui with A2UI 1.0 operations built from the components in the generative UI guide.",
        }),
      },
    }),
    basePath: "/api/minimal",
    hooks: agentRouteHooks(),
  });
  return handler;
}

export const GET = (request: Request) => minimalHandler()(request);
export const POST = (request: Request) => minimalHandler()(request);
