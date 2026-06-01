// Dedicated runtime for the Agent Config Object demo (Langroid).
//
// The <CopilotKit properties={...}> provider forwards tone / expertise /
// responseLength on every run; the V1 Next.js runtime propagates those as
// top-level keys on the AG-UI `forwardedProps` payload.
//
// Upstream parity (see langgraph-python route for the canonical logic):
// the frontend's provider properties arrive flat on `forwardedProps`
// (e.g. `forwardedProps.tone`). The LangGraph showcase's Python graph
// reads them from `RunnableConfig.configurable.properties`, so the TS
// adapter there repacks flat keys into
// `forwardedProps.config.configurable.properties` before dispatching.
//
// Langroid's backend does not have a LangGraph RunnableConfig, but we
// mirror the same payload shape here so:
//   1. The frontend contract is identical across all showcases.
//   2. The Langroid Python backend can read the repacked location
//      (`run_input.forwarded_props.config.configurable.properties`)
//      deterministically — top-level flat keys would collide with any
//      future AG-UI additions to `forwardedProps`.
//
// We subclass `HttpAgent` and override `requestInit` (the only place in
// the AG-UI client that serializes the body) so the repack happens once
// per request with no middleware plumbing.
//
// Scoped to its own endpoint so non-demo cells don't pay the cost of
// this repack and so the Playwright spec can assert request-body
// propagation against exactly one URL.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Reserved AG-UI / LangGraph stream-payload keys that MUST NOT be repacked
// under `configurable.properties`. Anything outside this set is treated as
// user-supplied frontend state (tone / expertise / responseLength / ...) and
// moved into `forwardedProps.config.configurable.properties`.
//
// Keep this list in sync with the upstream canonical implementation:
// `showcase/integrations/langgraph-python/src/app/api/copilotkit-agent-config/route.ts`.
const RESERVED_FORWARDED_PROPS_KEYS = new Set<string>([
  "config",
  "command",
  "streamMode",
  "streamSubgraphs",
  "nodeName",
  "threadMetadata",
  "checkpointId",
  "checkpointDuring",
  "interruptBefore",
  "interruptAfter",
  "multitaskStrategy",
  "ifNotExists",
  "afterSeconds",
  "onCompletion",
  "onDisconnect",
  "webhook",
  "feedbackKeys",
  "metadata",
]);

type RunInputWithForwardedProps = RunAgentInput & {
  forwardedProps?: Record<string, unknown>;
};

function repackForwardedPropsIntoConfigurable<
  T extends RunInputWithForwardedProps,
>(input: T): T {
  const fp = (input.forwardedProps ?? {}) as Record<string, unknown>;
  if (!fp || typeof fp !== "object") return input;

  const userProps: Record<string, unknown> = {};
  const structural: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fp)) {
    if (RESERVED_FORWARDED_PROPS_KEYS.has(key)) {
      structural[key] = value;
    } else {
      userProps[key] = value;
    }
  }

  if (Object.keys(userProps).length === 0) return input;

  const existingConfig = (structural.config ?? {}) as {
    configurable?: Record<string, unknown>;
    [k: string]: unknown;
  };
  const existingConfigurable =
    (existingConfig.configurable as Record<string, unknown> | undefined) ?? {};
  const existingProperties =
    (existingConfigurable.properties as Record<string, unknown> | undefined) ??
    {};

  const mergedConfig = {
    ...existingConfig,
    configurable: {
      ...existingConfigurable,
      properties: {
        ...existingProperties,
        ...userProps,
      },
    },
  };

  return {
    ...input,
    forwardedProps: {
      ...structural,
      config: mergedConfig,
    },
  } as T;
}

/**
 * `HttpAgent` subclass that repacks provider `properties` (flat top-level
 * keys on `forwardedProps`) into `forwardedProps.config.configurable.properties`
 * before the body is serialized and POSTed to the Langroid Python backend.
 *
 * `requestInit` is the single place in the AG-UI client where the payload
 * is serialized (`body: JSON.stringify(input)`), so overriding it here is
 * the minimum-surface hook — no middleware plumbing, no clone semantics
 * to preserve.
 */
class AgentConfigHttpAgent extends HttpAgent {
  protected requestInit(input: RunAgentInput): RequestInit {
    const repacked = repackForwardedPropsIntoConfigurable(
      input as RunInputWithForwardedProps,
    );
    return super.requestInit(repacked as RunAgentInput);
  }
}

const agentConfigAgent = new AgentConfigHttpAgent({ url: `${AGENT_URL}/` });

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
