// Dedicated runtime for the Multimodal Attachments demo.
//
// Mirrors the LangGraph-Python shape: the multimodal cell gets its own
// runtime so vision-capable model settings stay scoped to that one cell.
// The backend is the shared Cloudflare agent (`showcase` in src/agent, served
// by the Worker on port 8000); this route just registers the demo's slug
// against the same agent as the main route. Attachments reach the model as
// AI SDK image/file parts (@ag-ui/cloudflare-agents converts them).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { cloudflareAgent, withForwardedHeaders } from "@/lib/cloudflare-agents";

function createAgent() {
  return cloudflareAgent("showcase");
}

const multimodalAgent = createAgent();
const agents = {
  "multimodal-demo": multimodalAgent,
  default: multimodalAgent,
};

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const copilotHandler = createCopilotRuntimeHandler({
        runtime: new CopilotRuntime({
          // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
          agents,
        }),
        basePath: "/api/copilotkit-multimodal",
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
  });
