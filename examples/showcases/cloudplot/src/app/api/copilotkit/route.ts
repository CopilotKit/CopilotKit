import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  FixedWindowLimiter,
  SESSION_COOKIE_NAME,
  getClientKey,
  getRuntimeSecurityConfiguration,
  verifySessionValue,
} from "../../../lib/runtimeSecurity";

// 1. You can use any service adapter here for multi-agent support. We use
//    the empty adapter since we're only using one agent.
const serviceAdapter = new ExperimentalEmptyAdapter();

function getLangGraphDeploymentUrl() {
  if (process.env.LANGGRAPH_DEPLOYMENT_URL) {
    return process.env.LANGGRAPH_DEPLOYMENT_URL;
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:8123";
  }

  throw new Error(
    "LANGGRAPH_DEPLOYMENT_URL is required for the Cloudplot frontend service.",
  );
}

// The self-hosted FastAPI service speaks AG-UI directly.
const runtime = new CopilotRuntime({
  agents: {
    cloudplot_agent: new LangGraphHttpAgent({
      url: `${getLangGraphDeploymentUrl().replace(/\/$/, "")}/`,
    }),
  },
});

const clientLimiter = new FixedWindowLimiter({
  limit: 20,
  windowMs: 60 * 1_000,
  maxKeys: 10_000,
});
const globalLimiter = new FixedWindowLimiter({
  limit: 1_000,
  windowMs: 24 * 60 * 60 * 1_000,
  maxKeys: 1,
});

function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "CloudPlot request limit reached. Try again later." },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

// 3. Build a Next.js API route that handles the CopilotKit runtime requests.
export const POST = async (req: NextRequest) => {
  const configuration = getRuntimeSecurityConfiguration();
  if (configuration.mode === "misconfigured") {
    return NextResponse.json(
      { error: "CloudPlot access control is not configured." },
      { status: 503 },
    );
  }
  if (
    configuration.mode === "protected" &&
    !verifySessionValue(
      req.cookies.get(SESSION_COOKIE_NAME)?.value,
      configuration,
    )
  ) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const clientLimit = clientLimiter.consume(
    getClientKey(req.headers, Boolean(process.env.RAILWAY_ENVIRONMENT_ID)),
  );
  if (!clientLimit.allowed) {
    return rateLimitedResponse(clientLimit.retryAfterSeconds);
  }
  const globalLimit = globalLimiter.consume("all-runtime-requests");
  if (!globalLimit.allowed) {
    return rateLimitedResponse(globalLimit.retryAfterSeconds);
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
