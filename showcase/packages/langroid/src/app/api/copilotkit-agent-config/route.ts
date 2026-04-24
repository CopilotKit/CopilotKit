// Dedicated runtime for the Agent Config Object demo (Langroid).
//
// The <CopilotKit properties={...}> provider forwards tone / expertise /
// responseLength on every run; the V1 Next.js runtime propagates those as
// forwarded_props on the AG-UI RunAgentInput payload. The unified Langroid
// agent reads them (when wired) from that field to steer its system prompt.
//
// Scoped to its own endpoint so non-demo cells don't pay the cost of this
// demo's properties plumbing and so the Playwright spec can assert
// request-body propagation against exactly one URL.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agentConfigAgent = new HttpAgent({ url: `${AGENT_URL}/` });

const agents = {
  "agent-config-demo": agentConfigAgent,
  // Internal components calling useAgent() with no args default to "default".
  default: agentConfigAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
  // MaybePromise<NonEmptyRecord<...>> which rejects plain Records.
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-agent-config",
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
