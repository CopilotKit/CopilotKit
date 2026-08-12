// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. The backend is the dedicated `a2ui_dynamic.py` agent mounted at
// `/declarative-gen-ui` (NOT the root catch-all `agent.py`): it is an ag2
// `A2UIServer` + `AgUiTransport`, so the BACKEND owns A2UI generation. ag2
// injects its server-side catalog into the prompt, validates the model's
// `<a2ui-json>` block, and emits the validated operations as the AG-UI
// `a2ui-surface` activity the frontend renderer paints.
//
// Hence `injectA2UITool: false`: the JS middleware must not inject its
// `render_a2ui` tool or drive a secondary LLM pass — that would re-generate a
// surface the backend already produced. The middleware still runs, and passes
// the backend's `a2ui-surface` activity through untouched.
//
// The pydantic-ai / ms-agent-python siblings also set `injectA2UITool: false`,
// but there the backend returns `a2ui_operations` as a TOOL RESULT; ag2 emits
// them as an AG-UI activity instead. Both reach the same renderer.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "declarative-gen-ui": new HttpAgent({
      url: `${AGENT_URL}/declarative-gen-ui/`,
    }),
  },
  a2ui: {
    // The ag2 backend owns A2UI generation (see src/agents/a2ui_dynamic.py):
    // it emits validated operations directly, so the middleware must not
    // inject its `render_a2ui` tool or drive its own render pass. An explicit
    // `false` is respected even though the provider forwards a catalog (see
    // runtime handlers/shared/agent-utils.ts).
    injectA2UITool: false,
    // Declared for parity with the sibling cells, but inert on this path:
    // `defaultCatalogId` is only consulted where the middleware SYNTHESISES a
    // surface from a `render_a2ui`-style toolcall, and this backend emits none.
    // The catalogId that reaches the renderer is the one ag2 stamps on every
    // `createSurface` — the `$id` of the server-side catalog, which must stay
    // equal to the value below and to the id the page registers.
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
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
