import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { MastraAgent, getLocalAgent } from "@ag-ui/mastra";
import { NextRequest, NextResponse } from "next/server";
import { mastra } from "@/mastra";

const serviceAdapter = new ExperimentalEmptyAdapter();

// The Mastra config registers a single local agent (`weatherAgent`), but the
// demo pages request a variety of agent names (`agentic_chat`,
// `human_in_the_loop`, etc.). Mirror the crewai-crews pattern and expose the
// same underlying agent under every name the demos ask for so the runtime can
// resolve them. `mastra-weatherAgent` is also preserved for backend smoke tests.
//
// NOTE: This aliasing makes demo pages load without agent-name 404s.
// Demos that depend on specific agent capabilities (HITL interrupts,
// streaming state, gen-ui steps) remain limited by weatherAgent's features.
// Full feature parity requires dedicated Mastra agents per demo — see
// crewai-crews for the precedent pattern.
//
// IMPORTANT: This is the single source of truth for demo agent names. Any new
// demo added under `src/app/demos/<name>/` that calls the CopilotKit runtime
// MUST be added here, otherwise the runtime will return agent-not-found errors.
// There is no central registry — this list IS the registry.
export const demoAgentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
] as const;

export type BuiltAgents = Record<string, ReturnType<typeof getLocalAgent>>;

// Exported for tests; production callers should use `getAgents()` below so the
// result is memoized across requests.
export function buildAgents(
  mastraInstance: typeof mastra = mastra,
): BuiltAgents {
  // Mastra Memory requires a non-empty resourceId whenever a threadId is
  // supplied (the CopilotKit runtime always supplies threadId). Passing an
  // empty string causes Mastra to throw AGENT_MEMORY_MISSING_RESOURCE_ID on
  // every chat turn, which breaks the agentic-chat and tool-rendering demos.
  //
  // Give each demo its own stable resourceId so working-memory buckets don't
  // cross-contaminate between demos. `mastra-weatherAgent` keeps a baseline id
  // for direct smoke-test traffic that hits the underlying agent name.
  const localAgents = MastraAgent.getLocalAgents({
    mastra: mastraInstance,
    resourceId: "mastra-weatherAgent",
  });
  if (!localAgents.weatherAgent) {
    throw new Error(
      "weatherAgent missing from Mastra config — required for demo aliases",
    );
  }

  // Guard against silent shadowing: if Mastra ever registers a local agent
  // whose key collides with a demo alias, the spread order below would
  // silently overwrite it (or vice versa). Fail loudly instead.
  const localAgentKeys = new Set(Object.keys(localAgents));
  const collisions = demoAgentNames.filter((name) => localAgentKeys.has(name));
  if (collisions.length > 0) {
    throw new Error(
      `demoAgentNames collide with existing Mastra local agents: ${collisions.join(", ")}`,
    );
  }

  // Track every resourceId we hand out so we can fail loudly if two demos
  // accidentally share one (would cause cross-demo working-memory contamination).
  const resourceIdByAgent = new Map<string, string>();
  resourceIdByAgent.set("weatherAgent", "mastra-weatherAgent");

  const demoAliases: BuiltAgents = {};
  for (const name of demoAgentNames) {
    const resourceId = `mastra-${name}`;
    const agent = getLocalAgent({
      mastra: mastraInstance,
      agentId: "weatherAgent",
      resourceId,
    });
    if (!agent) {
      throw new Error(`getLocalAgent returned null for ${name}`);
    }
    demoAliases[name] = agent;
    resourceIdByAgent.set(name, resourceId);
  }

  // Assert resourceId uniqueness across every agent we're about to expose.
  const seen = new Map<string, string>();
  for (const [agentName, resourceId] of resourceIdByAgent) {
    const existing = seen.get(resourceId);
    if (existing) {
      throw new Error(
        `duplicate resourceId "${resourceId}" shared by agents "${existing}" and "${agentName}"`,
      );
    }
    seen.set(resourceId, agentName);
  }

  // Spread demoAliases FIRST so localAgents win on any future collision. The
  // explicit collision check above makes this defensive rather than load-bearing,
  // but keep both so the guard-rail doesn't depend on spread order alone.
  return {
    ...demoAliases,
    ...localAgents,
  };
}

// Memoize buildAgents() so we don't rebuild the agent map on every request.
// The Mastra instance is module-scoped and effectively immutable at runtime,
// so one-time construction is safe.
let cachedAgents: BuiltAgents | null = null;
function getAgents(): BuiltAgents {
  if (cachedAgents === null) {
    cachedAgents = buildAgents();
  }
  return cachedAgents;
}

// Test hook: reset memoized agents so unit tests can observe rebuilds.
export function __resetAgentsCacheForTests(): void {
  cachedAgents = null;
}

// Next.js App Router POST handler for CopilotKit runtime requests. Wraps the
// runtime's handler so any synchronous construction error (bad mastra config,
// missing weatherAgent, etc.) surfaces as a structured 500 instead of an
// unhandled promise rejection.
export const POST = async (req: NextRequest) => {
  try {
    const runtime = new CopilotRuntime({
      agents: getAgents(),
    });

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime,
      serviceAdapter,
      endpoint: "/api/copilotkit",
    });

    return await handleRequest(req);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(
      "[copilotkit route] handleRequest failed:",
      error.stack ?? error.message,
    );
    return NextResponse.json(
      {
        error: "CopilotKit runtime error",
        message: error.message,
      },
      { status: 500 },
    );
  }
};
