// Dedicated runtime for the A2UI — Fixed Schema cell.
//
// The claude-sdk reference set `a2ui.injectA2UITool: false` because its backend
// owned a `display_flight` tool that emitted the `a2ui_operations` container
// itself. OpenClaw's gateway is a pass-through with no such backend tool, so we
// instead let the A2UI middleware inject its generic `render_a2ui` tool (the
// same path declarative-gen-ui uses and which is proven to relay through the
// gateway). The "fixed schema" character is preserved on the FRONTEND: the page
// wires a constrained catalog via `<CopilotKit a2ui={{ catalog }}>`, so the
// model's operations can only populate that catalog's components. (This is a
// generative-into-a-fixed-catalog variant of the reference's data-only flow.)
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-a2ui-fixed-schema/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createGatewayAgent } from "@/lib/openclaw-agent";

const a2uiFixedSchemaAgent = createGatewayAgent();

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents: { "a2ui-fixed-schema": a2uiFixedSchemaAgent },
  a2ui: {
    // The OpenClaw backend now owns `display_flight` (in the showcase-tools
    // plugin), which emits its own `a2ui_operations` container -- the
    // fleet-standard pattern (matches langgraph-python). We still run the A2UI
    // middleware so it detects the container in the tool result and forwards
    // the surface to the frontend catalog, but we do NOT inject a runtime
    // `render_a2ui` tool: that injection is not forwarded through the
    // pass-through HttpAgent to the gateway, so it never reached the model.
    injectA2UITool: false,
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
