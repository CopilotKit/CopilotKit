import { HttpAgent } from "@ag-ui/client";
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { AGENT_ID } from "@/lib/agent-id";
import { serverEnv } from "@/lib/env";
import { userFromCookieHeader } from "@/lib/user";

const env = serverEnv();

// The Python process in agent/: an AG-UI endpoint in front of Google
// Antigravity's Go harness. The harness, not this runtime, calls the model.
const agent = new HttpAgent({ url: env.AGENT_URL });

const runtime = new CopilotRuntime({
  agents: { [AGENT_ID]: agent },
  // run_tests returns an `a2ui_operations` envelope (A2UI v0.9). The runtime
  // finds it in the tool result and converts the surface to A2UI 1.0, which
  // the browser paints with the catalog from src/a2ui. The agent owns its
  // tools, so the runtime does not inject its own render_a2ui tool.
  generativeUI: { a2uiVersion: "0.9", injectA2UITool: false },
  ...(env.CPK_INTELLIGENCE_API_KEY
    ? {
        // Threads (AG-UI Streams) and Product Analytics.
        intelligence: new CopilotKitIntelligence({
          apiKey: env.CPK_INTELLIGENCE_API_KEY,
          ...(env.INTELLIGENCE_API_URL
            ? { apiUrl: env.INTELLIGENCE_API_URL }
            : {}),
          ...(env.INTELLIGENCE_GATEWAY_WS_URL
            ? { wsUrl: env.INTELLIGENCE_GATEWAY_WS_URL }
            : {}),
        }),
        // Off: the runtime would name each new thread by running this agent a
        // second time (a new thread id, so a second Antigravity session,
        // workspace and Gemini turn). The thread list names threads from their
        // first message instead (src/components/shell/thread-list.tsx).
        generateThreadNames: false,
        // The person who typed their name in the navbar (a cookie), so threads
        // and Product Analytics are per person. Not authentication: replace it
        // with your own server-verified session before going public.
        identifyUser: (request: Request) =>
          userFromCookieHeader(request.headers.get("cookie")) ?? {
            id: env.DEMO_USER_ID,
            name: "Demo user",
          },
      }
    : { runner: new InMemoryAgentRunner() }),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
