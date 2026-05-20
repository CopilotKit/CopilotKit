// Dedicated runtime for the Agent Config Object demo.
//
// This runtime hosts a single LangGraph agent (`agent_config_agent`).
// The Python graph reads three properties — tone / expertise / responseLength
// — from `RunnableConfig["configurable"]["properties"]` to build its system
// prompt dynamically per turn (see `src/agents/agent_config_agent.py`).
//
// ── Property-forwarding regression note ────────────────────────────
// Previously this route used a custom `AgentConfigLangGraphAgent` subclass
// that repacked the CopilotKit provider's `properties` into
// `forwardedProps.config.configurable.properties` so the Python graph could
// read them. That stopped working with `@ag-ui/langgraph@0.0.31`, which
// builds the LangGraph SDK request as
// `{ ..., config, context: { ...input.context, ...config.configurable } }`
// — i.e. it merges `configurable` INTO `context`. LangGraph 0.6.0+ rejects
// any request that sets both `configurable` and `context`:
//
//   HTTP 400: "Cannot specify both configurable and context. Prefer setting
//   context alone. Context was introduced in LangGraph 0.6.0 and is the long
//   term planned replacement for configurable."
//
// Net effect: any forwardedProps that landed in `configurable.<key>` made
// the chat round-trip 400 unconditionally — the user message rendered, but
// no assistant reply ever came back.
//
// To unbreak the chat round-trip, this route now uses the plain
// `LangGraphAgent` and stops repacking properties into `configurable`. The
// Python graph falls back to its `DEFAULT_*` constants, so the demo's
// frontend toggles no longer affect the agent's response style. The
// property-forwarding feature is tracked as a known regression pending an
// `@ag-ui/langgraph` fix that decouples `context` from `configurable`.
//
// References:
// - src/agents/agent_config_agent.py — the graph (still reads
//   configurable.properties; falls back to DEFAULT_* when missing)
// - src/app/demos/agent-config/page.tsx — the provider config
// - node_modules/.pnpm/@ag-ui+langgraph@0.0.31_*/dist/index.js — the
//   prepareStream merge that introduces the conflict

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.AGENT_URL ||
  process.env.LANGGRAPH_DEPLOYMENT_URL ||
  "http://localhost:8123";

const agentConfigAgent = new LangGraphAgent({
  deploymentUrl: LANGGRAPH_URL,
  graphId: "agent_config_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const agents: Record<string, LangGraphAgent> = {
  // The page's <CopilotKitProvider agent="agent-config-demo"> resolves here.
  "agent-config-demo": agentConfigAgent,
  // Internal components (headless-chat, example-canvas) call `useAgent()` with
  // no args, which defaults to agentId "default". Alias to the same graph so
  // those component hooks resolve instead of throwing "Agent 'default' not
  // found".
  default: agentConfigAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
  // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in
  // source, pending release.
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
