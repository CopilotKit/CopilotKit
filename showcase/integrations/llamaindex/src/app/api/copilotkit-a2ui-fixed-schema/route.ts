// Dedicated runtime for the A2UI Fixed Schema demo.
//
// The backend agent (src/agents/a2ui_fixed.py) emits a STREAMED `render_a2ui`
// tool-CALL carrying the pre-authored flight schema plus a runtime data model.
// The A2UI middleware watches that streamed call (because `injectA2UITool: true`
// populates its watched-names set with `render_a2ui`) and streams the rendered
// surface to the frontend's fixed catalog. A `TOOL_CALL_RESULT` does NOT mount
// the surface — the llama-index AG-UI adapter only re-emits results via
// `MESSAGES_SNAPSHOT`, which the middleware ignores — so the agent re-emits the
// fixed schema as a streamed `render_a2ui` call instead (see the agent docstring).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const a2uiFixedAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui-fixed/run`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "a2ui-fixed-schema": a2uiFixedAgent as AbstractAgent },
  a2ui: {
    // Set `true` so the middleware WATCHES the `render_a2ui` tool-call name
    // (the watched-names set is only populated when the tool is injected). The
    // backend re-emits the fixed schema as a streamed `render_a2ui` call that
    // the middleware mounts the surface from; it does NOT call the injected
    // tool itself (the backend `display_flight` tool produces the schema).
    injectA2UITool: true,
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-fixed-schema",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
