// Dedicated runtime for the Agent Config Object demo.
//
// This runtime hosts a single PydanticAI agent (`agent_config_agent`) that
// reads three forwarded properties — tone / expertise / responseLength —
// from its AG-UI ``context`` at call time and builds its system prompt
// dynamically per turn.
//
// PydanticAI-specific adaptation
// ------------------------------
// langgraph-python's equivalent route extends `LangGraphAgent` and repacks
// `forwardedProps` into `forwardedProps.config.configurable.properties`
// (which the LangGraph SDK forwards to `RunnableConfig`). PydanticAI's
// AG-UI bridge does not surface `forwardedProps` that way; instead, it
// exposes the AG-UI `context` list via `ctx.deps.copilotkit.context` to
// every tool/dynamic-prompt.
//
// So this route subclasses `HttpAgent` and, on each run, appends a
// synthetic context entry describing the provider properties. The Python
// agent's dynamic `@agent.system_prompt` reads that entry and composes
// the prompt from the three axes (see `src/agents/agent_config_agent.py`).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Tag used on the synthetic context entry so the Python agent can pick
// it out reliably from any other agent-context entries in the run.
const PROPERTIES_CONTEXT_DESCRIPTION = "agent-config-properties";

// Keys on `forwardedProps` that are reserved AG-UI structural fields
// (e.g. `config`, `command`, `streamMode`). These are passed through
// unchanged; everything else on `forwardedProps` is treated as
// user-supplied provider properties and repacked into `context`.
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

type RunInputShape = {
  forwardedProps?: Record<string, unknown> | undefined;
  context?: Array<{ description: string; value: string }> | undefined;
  [k: string]: unknown;
};

/**
 * `HttpAgent` subclass that repacks provider `properties` (delivered as
 * top-level keys on `forwardedProps`) into an AG-UI ``context`` entry the
 * PydanticAI backend can read via ``ctx.deps.copilotkit.context``.
 */
class AgentConfigHttpAgent extends HttpAgent {
  // Explicit constructor so the subclass surfaces the same `{ url, ... }`
  // argument the parent accepts — TypeScript loses parameter inference
  // across certain cross-package declarations otherwise.
  constructor(args: ConstructorParameters<typeof HttpAgent>[0]) {
    // @ts-ignore -- ConstructorParameters resolves correctly at runtime;
    // the type error only appears because the type declarations in the
    // published @ag-ui/client package declare a no-arg constructor as
    // the primary overload.
    super(args);
  }

  run(input: Parameters<HttpAgent["run"]>[0]): ReturnType<HttpAgent["run"]> {
    const repacked = repackForwardedPropsIntoContext(input as RunInputShape);
    return super.run(repacked as Parameters<HttpAgent["run"]>[0]);
  }
}

function repackForwardedPropsIntoContext<T extends RunInputShape>(input: T): T {
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

  // Drop any stale prior entry so the freshly-selected properties win.
  const existingContext = Array.isArray(input.context) ? input.context : [];
  const filteredContext = existingContext.filter(
    (entry) => entry.description !== PROPERTIES_CONTEXT_DESCRIPTION,
  );
  const propertiesEntry = {
    description: PROPERTIES_CONTEXT_DESCRIPTION,
    value: JSON.stringify(userProps),
  };

  return {
    ...input,
    forwardedProps: structural,
    context: [...filteredContext, propertiesEntry],
  } as T;
}

const agentConfigAgent = new AgentConfigHttpAgent({
  url: `${AGENT_URL}/agent_config/`,
});

const agents: Record<string, AbstractAgent> = {
  "agent-config-demo": agentConfigAgent,
  default: agentConfigAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
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
