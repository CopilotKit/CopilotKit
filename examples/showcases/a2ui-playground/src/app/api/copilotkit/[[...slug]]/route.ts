import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { createPlaygroundAgent } from "@/agent/agent";
import { MAX_BODY, RATE_LIMITS, rateLimiter, readBody, tooLarge } from "@/lib/limits";

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

/**
 * Only the routes that run the agent spend model tokens, so only they count
 * toward the rate limit. `info` and `agent/connect` (sent when the page loads)
 * and `agent/stop` don't. Listing and clearing threads answer 403 as they
 * are: the runtime has no `identifyUser`.
 */
const RUNS = new Set(["agent/run", "agent/suggest"]);
const limitRuns = rateLimiter(RATE_LIMITS.agent, RATE_LIMITS.agentOverall);

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
  hooks: {
    // A Response thrown here is sent as it is.
    onBeforeHandler: async ({ request, route }) => {
      const body = request.body ? await readBody(request, MAX_BODY.agent) : undefined;
      if (body === null) throw tooLarge("This chat is too long to send. Open the playground in a new tab to start over.");
      const limited = RUNS.has(route.method) ? limitRuns(request) : undefined;
      if (limited) throw limited;
      if (body !== undefined) return new Request(request, { body });
    },
  },
});

export const GET = handler;
export const POST = handler;
