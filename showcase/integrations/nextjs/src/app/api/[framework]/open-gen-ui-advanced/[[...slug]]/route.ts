// showcase/integrations/nextjs/src/app/api/[framework]/open-gen-ui-advanced/[[...slug]]/route.ts
//
// Dedicated runtime for the Open Generative UI (Advanced) demo.
//
// Isolated here because the `openGenerativeUI` runtime flag sets
// `openGenerativeUIEnabled: true` globally on the probe response, which
// causes the CopilotKit provider's setTools effect to wipe per-demo
// `useFrontendTool`/`useComponent` registrations in the default runtime.
//
// The advanced variant adds host-side sandbox functions (evaluateExpression,
// notifyHost) registered on the frontend via the `sandboxFunctions` prop.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { frameworks } from "@/registry/frameworks";
import type { FrameworkSlug } from "@/registry/frameworks";

const DEMO_ID = "open-gen-ui-advanced";

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ framework: string }> },
) {
  const { framework: fwSlug } = await ctx.params;
  const fw = frameworks[fwSlug as FrameworkSlug];
  if (!fw)
    return NextResponse.json({ error: "unknown framework" }, { status: 404 });
  if (fw.backendUrl === "")
    return NextResponse.json(
      { error: "backend not configured" },
      { status: 503 },
    );

  // @region[advanced-runtime-config]
  const runtime = new CopilotRuntime({
    agents: {
      // @ts-ignore -- HttpAgent satisfies the agent contract at runtime; type mismatch fixed pending release
      [DEMO_ID]: new HttpAgent({ url: `${fw.backendUrl}/${DEMO_ID}/` }),
    },
    openGenerativeUI: {
      agents: [DEMO_ID],
    },
  });
  // @endregion[advanced-runtime-config]

  return createCopilotRuntimeHandler({
    runtime,
    basePath: `/api/${fwSlug}/${DEMO_ID}`,
  })(req);
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
