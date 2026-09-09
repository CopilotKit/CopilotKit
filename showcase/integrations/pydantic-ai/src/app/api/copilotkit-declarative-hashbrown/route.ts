// Dedicated runtime for the declarative-hashbrown demo.
//
// The frontend demo (`src/app/demos/declarative-hashbrown/page.tsx`) uses
// the canonical `declarative-hashbrown-demo` agent slug. The PydanticAI
// backend still mounts the underlying agent at `/byoc_hashbrown/` (see
// `src/agent_server.py`); only the user-facing slug + route surface were
// renamed to match the LGP canonical demo.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// The page mounts <CopilotKit agent="declarative-hashbrown-demo">; register
// that name + a `default` alias (for any internal useAgent() lookups).
const agents: Record<string, AbstractAgent> = {
  "declarative-hashbrown-demo": new HttpAgent({
    url: `${AGENT_URL}/byoc_hashbrown/`,
  }),
  default: new HttpAgent({ url: `${AGENT_URL}/byoc_hashbrown/` }),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-declarative-hashbrown",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
