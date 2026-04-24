import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// Dedicated runtime for the Open Generative UI demos.
//
// Isolated from the main `/api/copilotkit` runtime because the
// `openGenerativeUI` flag flips `openGenerativeUIEnabled: true` globally
// on the runtime info probe, which causes the CopilotKit provider's
// setTools effect to wipe per-demo `useFrontendTool` / `useComponent`
// registrations in the default runtime.
//
// Each OGUI agent is backed by a dedicated sub-path on the MS Agent
// Framework FastAPI server (see `src/agent_server.py`):
//   - /open-gen-ui          -> the minimal OGUI agent
//   - /open-gen-ui-advanced -> the advanced OGUI agent (sandbox functions)
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agents: Record<string, AbstractAgent> = {
  "open-gen-ui": new HttpAgent({ url: `${AGENT_URL}/open-gen-ui` }),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-ogui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      // The `openGenerativeUI` flag below turns on Open Generative UI for
      // the listed agent(s); the runtime middleware converts each agent's
      // streamed `generateSandboxedUi` tool call into `open-generative-ui`
      // activity events.
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts for type-comment rationale
        agents,
        openGenerativeUI: {
          agents: ["open-gen-ui"],
        },
      }),
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};
