// Dedicated runtime for the Agent Config Object demo (AG2).
//
// The page at src/app/demos/agent-config/page.tsx points its `runtimeUrl` at
// this endpoint and sets `agent="agent-config-demo"` (the slug registered
// below). The backing AG2 agent is a FastAPI sub-app mounted at
// `/agent-config` in src/agent_server.py, with its AGUIStream at the mount
// root — hence the trailing-slash URL, matching the sibling
// copilotkit-multimodal route's convention.
//
// Wire-contract bridge:
// The CopilotKit runtime forwards `CopilotKitCore.properties` as flat
// top-level keys on `forwardedProps`. To keep the wire contract identical
// across framework showcases (LangGraph / LlamaIndex / AG2 / etc.), we repack
// any non-structural forwardedProps key into
// `forwardedProps.config.configurable.properties` before forwarding the
// request to the Python backend. This mirrors the LlamaIndex showcase's
// agent-config route (see llamaindex/src/app/api/copilotkit-agent-config/
// route.ts) so a single TS-side wire contract serves all frameworks. (The
// AG2 demo page itself relays config via `useAgentContext` → shared state →
// ContextVariables, so the repack is a pass-through unless provider
// `properties` are supplied.)
//
// References:
// - src/agents/agent_config_agent.py — the AG2 agent + AGUIStream sub-app
// - src/app/demos/agent-config/page.tsx — the provider config

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
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
// `RunAgentExtendedInput["forwardedProps"]`. AG2's stream uses a subset of
// these, but the superset is safe: structural keys present in the request
// body pass through to AG-UI's canonical shape regardless of which backend
// consumes them.
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
 * recomposer can read them from a single canonical location instead of
 * sniffing top-level keys.
 */
class AgentConfigHttpAgent extends HttpAgent {
  // Passthrough constructor so TS sees the same signature HttpAgent
  // accepts ({ url }). Without this, subclassing narrows the inferred
  // constructor to zero-arg when @ag-ui/client isn't fully resolvable in
  // isolated typecheck passes.
  constructor(...args: ConstructorParameters<typeof HttpAgent>) {
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

// Trailing-slash mount root: src/agent_server.py mounts the agent-config
// FastAPI sub-app at /agent-config, and the sub-app mounts its AGUIStream
// at "/" (same shape as the multimodal agent).
const agentConfigAgent = new AgentConfigHttpAgent({
  url: `${AGENT_URL}/agent-config/`,
});

const agents = {
  "agent-config-demo": agentConfigAgent,
  default: agentConfigAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-agent-config",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-expect-error -- see main route.ts; published CopilotRuntime's `agents`
        // type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects
        // plain Records. Fixed in source, pending release.
        agents,
      }),
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    // Log full details server-side (operators grep `errorId` to correlate),
    // but never echo `err.message` / `err.stack` back to the HTTP client —
    // that leaks internal paths, dependency versions, and stack traces.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        scope: "copilotkit-agent-config/route",
        errorId,
        message: err.message,
        stack: err.stack,
      }),
    );
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};
