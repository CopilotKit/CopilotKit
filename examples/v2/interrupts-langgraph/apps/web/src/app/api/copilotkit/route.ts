import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest, NextResponse } from "next/server";

// 1. Runtime adapter. Since this starter wires agent responses directly
//    (no OpenAI/Anthropic-compatible chat-completions fallback), we use
//    the empty adapter: it satisfies the runtime interface without
//    dispatching any LLM requests of its own.
const serviceAdapter = new ExperimentalEmptyAdapter();

// 2. LANGGRAPH_DEPLOYMENT_URL handling. In development we fall back to
//    localhost:8125 (the port this starter's LangGraph dev server uses —
//    see apps/agent/package.json) and warn so the developer sees it. In
//    production a missing URL is almost always a misconfiguration — fail
//    loudly at module load rather than silently pointing at localhost and
//    producing cryptic request-time errors.
if (!process.env.LANGGRAPH_DEPLOYMENT_URL) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[copilotkit/route] LANGGRAPH_DEPLOYMENT_URL is required in production. " +
        "Set it to the deployed LangGraph endpoint for this starter.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[copilotkit/route] LANGGRAPH_DEPLOYMENT_URL is not set; falling back to http://localhost:8125. Set LANGGRAPH_DEPLOYMENT_URL in production.",
  );
}

// LangSmith is optional; warn once at module load so a missing key
// surfaces in logs. When absent we omit the langsmithApiKey field
// entirely rather than passing "" — omitting the field disables
// LangSmith tracing cleanly; passing an empty string may be forwarded
// to the SDK.
if (!process.env.LANGSMITH_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[copilotkit/route] LANGSMITH_API_KEY is not set; LangSmith tracing is disabled for this session.",
  );
}

const agent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8125",
  graphId: "default",
  // Only pass langsmithApiKey when it's a non-empty string; omitting
  // the field disables LangSmith tracing without asking the SDK to
  // authenticate with an empty key.
  ...(process.env.LANGSMITH_API_KEY
    ? { langsmithApiKey: process.env.LANGSMITH_API_KEY }
    : {}),
});

// 3. Register the single LangGraph agent under the `default` name, which
//    matches the <CopilotKit agent="default"> prop in layout.tsx. If you
//    need to expose this agent under an additional id (e.g. when pointing
//    a second frontend at this runtime), add another entry here and
//    update the corresponding <CopilotKit agent="..."> prop.
const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
});

// 4. Build a Next.js API route that handles the CopilotKit runtime requests.
//    Wrap handleRequest in try/catch so unhandled exceptions surface as a
//    structured 500 rather than a raw Next.js error page, and log the failure
//    for observability. Synchronous/setup errors (missing env, invalid
//    config) land here; errors inside the streaming response are handled
//    by the runtime itself.
export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime,
      serviceAdapter,
      endpoint: "/api/copilotkit",
    });

    return await handleRequest(req);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[copilotkit/route] handleRequest failed:", err);
    // Redact `detail` in production: raw error messages can leak
    // internals (stack-adjacent strings, paths, env-var names). Keep
    // the full detail in non-production builds so developers see the
    // real cause locally.
    const isProd = process.env.NODE_ENV === "production";
    return NextResponse.json(
      {
        error: "Internal error while dispatching CopilotKit request.",
        ...(isProd
          ? {}
          : { detail: err instanceof Error ? err.message : String(err) }),
      },
      { status: 500 },
    );
  }
};
