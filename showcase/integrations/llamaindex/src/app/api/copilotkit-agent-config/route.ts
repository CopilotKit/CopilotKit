// Dedicated runtime for the Agent Config Object demo.
//
// This runtime hosts a single LlamaIndex AG-UI router (`agent_config_agent`)
// that reads three forwarded properties — tone / expertise / responseLength —
// from the run's `forwardedProps.config.configurable.properties` and (when
// the Python side can recompose per-turn) builds its system prompt
// dynamically per turn. The <CopilotKitProvider properties={...}> in the demo
// page is the source of truth for those values.
//
// Scoped to its own endpoint so non-demo cells don't pay the cost of this
// agent's properties plumbing and so the Playwright spec can assert
// request-body propagation against exactly one URL.
//
// Wire-contract bridge:
// The CopilotKit runtime forwards `CopilotKitCore.properties` as flat
// top-level keys on `forwardedProps`. To keep the wire contract identical
// across framework showcases (LangGraph / LlamaIndex / etc.), we repack any
// non-structural forwardedProps key into
// `forwardedProps.config.configurable.properties` before forwarding the
// request to the Python router. This mirrors what the LangGraph subclass
// does upstream (see langgraph-python/src/app/api/copilotkit-agent-config/
// route.ts) so a single TS-side wire contract serves all frameworks.
//
// References:
// - src/agents/agent_config_agent.py — the llamaindex router
// - src/app/demos/agent-config/page.tsx — the provider config

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

// Shape of the AG-UI run input we care about. We avoid a direct import of
// `RunAgentInput` from `@ag-ui/client` so this route has no additional
// peer-dep on internal AG-UI packages — the field we touch (`forwardedProps`)
// is part of the stable AG-UI protocol contract.
type RunInputWithForwardedProps = {
  forwardedProps?: Record<string, unknown> | undefined;
  [k: string]: unknown;
};

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Keys on `forwardedProps` that AG-UI treats as reserved stream-payload
// fields (e.g. `config`, `command`, `streamMode`). These must NOT be
// repacked under `configurable.properties` — they are structural fields.
// Anything else on `forwardedProps` is user-supplied frontend state that
// needs to reach the Python agent.
//
// Kept in sync with ag-ui/langgraph/typescript/src/agent.ts
// `RunAgentExtendedInput["forwardedProps"]`. LlamaIndex's router uses a
// subset of these, but the superset is safe: structural keys present in the
// request body pass through to AG-UI's canonical shape regardless of which
// backend consumes them.
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

/**
 * Wrapper around `HttpAgent` that repacks the CopilotKit provider's
 * `properties` (which arrive as top-level keys on `forwardedProps`) into
 * `forwardedProps.config.configurable.properties`.
 *
 * Why this bridge exists: the CopilotKit runtime forwards
 * `CopilotKitCore.properties` as `forwardedProps` (see core's run-handler).
 * For wire-contract consistency with the LangGraph showcase, we stash them
 * under `forwardedProps.config.configurable.properties` so a Python-side
 * recomposer (when llamaindex exposes one) can read them from a single
 * canonical location instead of sniffing top-level keys.
 */
class AgentConfigHttpAgent extends HttpAgent {
  // Passthrough constructor so TS sees the same signature HttpAgent
  // accepts ({ url }). Without this, subclassing narrows the inferred
  // constructor to zero-arg when @ag-ui/client isn't fully resolvable in
  // isolated typecheck passes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(...args: any[]) {
    // @ts-ignore -- forwarding to the base constructor's declared arg shape.
    super(...args);
  }

  // Intercept each run() to repack provider `properties` (which land on
  // `forwardedProps`) into `forwardedProps.config.configurable.properties`.
  run(input: Parameters<HttpAgent["run"]>[0]): ReturnType<HttpAgent["run"]> {
    const repacked = repackForwardedPropsIntoConfigurable(
      input as unknown as RunInputWithForwardedProps,
    );
    return super.run(repacked as unknown as Parameters<HttpAgent["run"]>[0]);
  }
}

function repackForwardedPropsIntoConfigurable<
  T extends RunInputWithForwardedProps,
>(input: T): T {
  const fp = (input.forwardedProps ?? {}) as Record<string, unknown>;
  if (!fp || typeof fp !== "object") return input;

  // Split forwardedProps into (structural) and (user-supplied) halves.
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

const agentConfigAgent = new AgentConfigHttpAgent({
  url: `${AGENT_URL}/agent-config/run`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "agent-config-demo": agentConfigAgent as AbstractAgent,
    default: agentConfigAgent as AbstractAgent,
  },
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
