// Dedicated runtime for the Agent Config Object demo.
//
// The CopilotKit provider on the frontend (src/app/demos/agent-config/page.tsx)
// forwards `{tone, expertise, responseLength}` via <CopilotKit properties={...}>.
// The runtime takes those provider `properties` and attaches them as
// top-level keys on the AG-UI run's `forwardedProps` envelope.
//
// This route subclasses the `HttpAgent` so it can intercept each run and
// repack the non-structural forwardedProps keys into
// `forwardedProps.config.configurable.properties` — the same shape the
// langgraph-python reference uses (and the agent-config Python backend
// accepts both shapes defensively; see
// src/agents/agent_config_agent.py :: `read_properties`). Repacking
// keeps the wire format consistent across frameworks so the Python
// backend can be compared directly against the LangGraph reference.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Shape of the AG-UI run input we care about. We avoid a direct import
// of `RunAgentInput` from `@ag-ui/client` so this route has no
// additional peer-dep on internal AG-UI packages — the field we touch
// (`forwardedProps`) is part of the stable AG-UI protocol contract.
type RunInputWithForwardedProps = {
  forwardedProps?: Record<string, unknown> | undefined;
  [k: string]: unknown;
};

// Keys on `forwardedProps` that should NOT be repacked into
// `configurable.properties`. These mirror the reserved list from
// `@ag-ui/langgraph` so a future refactor that aliases this route to
// the langgraph shape remains drop-in compatible.
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
 * HttpAgent subclass that repacks the CopilotKit provider's `properties`
 * (which arrive as top-level keys on `forwardedProps`) into
 * `forwardedProps.config.configurable.properties` so the Python backend
 * can read them from a stable location regardless of which framework
 * (Claude Agent SDK, LangGraph, etc.) drives the agent.
 *
 * The backend's `read_properties` (src/agents/agent_config_agent.py)
 * accepts both the nested shape and the flat top-level shape for
 * resilience — but we standardise on the nested shape at this boundary
 * so the wire format matches the langgraph-python reference and
 * Playwright specs can assert against a consistent payload shape.
 */
class AgentConfigHttpAgent extends HttpAgent {
  run(input: Parameters<HttpAgent["run"]>[0]): ReturnType<HttpAgent["run"]> {
    const repacked = repackForwardedPropsIntoConfigurable(
      input as unknown as RunInputWithForwardedProps,
    );
    return super.run(repacked as Parameters<HttpAgent["run"]>[0]);
  }
}

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

function createAgent(): AbstractAgent {
  // @ts-ignore -- dangling @ag-ui/client symlink in some install
  // topologies causes tsc to lose the HttpAgent constructor signature.
  // At runtime the constructor takes `{ url: string }` and works fine;
  // the other routes in this package silence the same symptom with
  // `@ts-ignore` on the CopilotRuntime `agents` property (see
  // src/app/api/copilotkit/route.ts).
  return new AgentConfigHttpAgent({
    url: `${AGENT_URL}/agent-config`,
  });
}

const agents: Record<string, AbstractAgent> = {
  "agent-config-demo": createAgent(),
  default: createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-agent-config",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
      }),
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
