import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { MastraAgent, getLocalAgent } from "@ag-ui/mastra";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { mastra } from "@/mastra";

// We use ExperimentalEmptyAdapter because Mastra agents drive the LLM
// themselves — the CopilotKit runtime only brokers AG-UI events between
// the frontend and the agent. A real adapter (OpenAI/Anthropic/etc.) would
// try to issue its own LLM calls and conflict with the agent's own loop.
const serviceAdapter = new ExperimentalEmptyAdapter();

// Startup log: make the adapter choice visible in boot logs so operators
// debugging "why is the runtime not calling the LLM?" can find the answer
// without reading source.
console.log(
  "[copilotkit route] init: serviceAdapter=ExperimentalEmptyAdapter (Mastra agents drive the LLM)",
);

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
  "shared-state-read-write",
  "shared-state-streaming",
  "subagents",
  // Parity-with-langgraph-python demos — all currently map to the same
  // underlying weatherAgent. Each gets a unique resourceId so working-memory
  // buckets don't cross-contaminate. A future refactor can split these into
  // dedicated Mastra agents when per-demo behavior diverges from weatherAgent.
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "frontend_tools",
  "frontend-tools-async",
  "hitl-in-chat",
  "hitl-in-app",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "agentic-chat-reasoning",
  "reasoning-default-render",
  "readonly-state-agent-context",
  "agent-config",
  "declarative-gen-ui",
  "a2ui-fixed-schema",
  "headless-complete",
  "tool-rendering-reasoning-chain",
  "gen-ui-interrupt",
  "interrupt-headless",
] as const;

// Per-demo override map: any demo alias listed here resolves to a dedicated
// Mastra agent instead of the shared weatherAgent. Add a mapping here when a
// demo needs its own system prompt / tool set (e.g. the headless-complete
// demo uses a prompt that routes weather/stock/highlight requests).
const demoAgentIdOverrides: Partial<Record<DemoAgentName, string>> = {
  "headless-complete": "headlessCompleteAgent",
  "shared-state-read-write": "sharedStateReadWriteAgent",
  subagents: "subagentsSupervisorAgent",
  "gen-ui-interrupt": "interruptAgent",
  "interrupt-headless": "interruptAgent",
};

export type DemoAgentName = (typeof demoAgentNames)[number];

// Narrowed agent-map type. Keys are exactly the demo aliases plus
// `weatherAgent`; values are the non-null result of `getLocalAgent`. If
// someone drops `as const` on `demoAgentNames` or widens this type back to
// `Record<string, ...>`, the type-level test under tests/vitest/builtAgents.types.test.ts
// should break `tsc --noEmit`.
// Baseline local-agent keys Mastra registers under — these are the keys
// handed back from `MastraAgent.getLocalAgents({ mastra })`. Keep this
// narrowed alongside `mastra.agents` in `src/mastra/index.ts`; any agent
// added there must be added here too.
export type LocalMastraAgentName =
  | "weatherAgent"
  | "headlessCompleteAgent"
  | "sharedStateReadWriteAgent"
  | "subagentsSupervisorAgent"
  | "interruptAgent"
  | "multimodalAgent"
  | "mcpAppsAgent"
  | "byocHashbrownAgent";

export type BuiltAgents = Record<
  DemoAgentName | LocalMastraAgentName,
  NonNullable<ReturnType<typeof getLocalAgent>>
>;

// Baseline resourceId for weatherAgent. Kept as a named const so tests and
// future refactors don't have to hardcode the string.
const weatherResourceId = "mastra-weatherAgent";

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
  // Dedicated per-local-agent resourceIds. `getLocalAgents` applies one
  // resourceId to every local agent, which would make headlessCompleteAgent
  // share weatherAgent's working-memory bucket. Rebind each local agent
  // under its own id via `getLocalAgent` (keyed by agentId) so the buckets
  // stay disjoint.
  const baseLocalAgents = MastraAgent.getLocalAgents({
    mastra: mastraInstance,
    resourceId: weatherResourceId,
  });
  if (!baseLocalAgents.weatherAgent) {
    throw new Error(
      "weatherAgent missing from Mastra config — required for demo aliases",
    );
  }
  if (!baseLocalAgents.headlessCompleteAgent) {
    throw new Error(
      "headlessCompleteAgent missing from Mastra config — required for headless-complete demo alias",
    );
  }
  if (!baseLocalAgents.sharedStateReadWriteAgent) {
    throw new Error(
      "sharedStateReadWriteAgent missing from Mastra config — required for shared-state-read-write demo alias",
    );
  }
  if (!baseLocalAgents.subagentsSupervisorAgent) {
    throw new Error(
      "subagentsSupervisorAgent missing from Mastra config — required for subagents demo alias",
    );
  }
  if (!baseLocalAgents.interruptAgent) {
    throw new Error(
      "interruptAgent missing from Mastra config — required for gen-ui-interrupt/interrupt-headless demos",
    );
  }
  if (!baseLocalAgents.multimodalAgent) {
    throw new Error(
      "multimodalAgent missing from Mastra config — required for /demos/multimodal",
    );
  }
  if (!baseLocalAgents.mcpAppsAgent) {
    throw new Error(
      "mcpAppsAgent missing from Mastra config — required for /demos/mcp-apps",
    );
  }
  if (!baseLocalAgents.byocHashbrownAgent) {
    throw new Error(
      "byocHashbrownAgent missing from Mastra config — required for /demos/byoc-hashbrown",
    );
  }
  const headlessCompleteAgentInstance = getLocalAgent({
    mastra: mastraInstance,
    agentId: "headlessCompleteAgent",
    resourceId: "mastra-headlessCompleteAgent",
  });
  if (!headlessCompleteAgentInstance) {
    throw new Error("getLocalAgent returned null for headlessCompleteAgent");
  }
  const sharedStateRWAgentInstance = getLocalAgent({
    mastra: mastraInstance,
    agentId: "sharedStateReadWriteAgent",
    resourceId: "mastra-sharedStateReadWriteAgent",
  });
  if (!sharedStateRWAgentInstance) {
    throw new Error(
      "getLocalAgent returned null for sharedStateReadWriteAgent",
    );
  }
  const subagentsSupervisorAgentInstance = getLocalAgent({
    mastra: mastraInstance,
    agentId: "subagentsSupervisorAgent",
    resourceId: "mastra-subagentsSupervisorAgent",
  });
  if (!subagentsSupervisorAgentInstance) {
    throw new Error("getLocalAgent returned null for subagentsSupervisorAgent");
  }
  const interruptAgentInstance = getLocalAgent({
    mastra: mastraInstance,
    agentId: "interruptAgent",
    resourceId: "mastra-interruptAgent",
  });
  if (!interruptAgentInstance) {
    throw new Error("getLocalAgent returned null for interruptAgent");
  }
  const multimodalAgentInstance = getLocalAgent({
    mastra: mastraInstance,
    agentId: "multimodalAgent",
    resourceId: "mastra-multimodalAgent",
  });
  if (!multimodalAgentInstance) {
    throw new Error("getLocalAgent returned null for multimodalAgent");
  }
  const mcpAppsAgentInstance = getLocalAgent({
    mastra: mastraInstance,
    agentId: "mcpAppsAgent",
    resourceId: "mastra-mcpAppsAgent",
  });
  if (!mcpAppsAgentInstance) {
    throw new Error("getLocalAgent returned null for mcpAppsAgent");
  }
  const byocHashbrownAgentInstance = getLocalAgent({
    mastra: mastraInstance,
    agentId: "byocHashbrownAgent",
    resourceId: "mastra-byocHashbrownAgent",
  });
  if (!byocHashbrownAgentInstance) {
    throw new Error("getLocalAgent returned null for byocHashbrownAgent");
  }
  const localAgents = {
    weatherAgent: baseLocalAgents.weatherAgent,
    headlessCompleteAgent: headlessCompleteAgentInstance,
    sharedStateReadWriteAgent: sharedStateRWAgentInstance,
    subagentsSupervisorAgent: subagentsSupervisorAgentInstance,
    interruptAgent: interruptAgentInstance,
    multimodalAgent: multimodalAgentInstance,
    mcpAppsAgent: mcpAppsAgentInstance,
    byocHashbrownAgent: byocHashbrownAgentInstance,
  };

  // Guard against silent shadowing: if Mastra ever registers a local agent
  // whose key collides with a demo alias, the spread order below would
  // silently overwrite it (or vice versa). Fail loudly instead. We check
  // both the curated `localAgents` map AND the full set of keys returned
  // by `MastraAgent.getLocalAgents` — the latter catches rogue agents we
  // don't know about yet (e.g. someone registers a new Mastra agent whose
  // name happens to match a demo alias).
  const knownLocalAgentKeys = new Set([
    ...Object.keys(localAgents),
    ...Object.keys(baseLocalAgents),
  ]);
  const collisions = demoAgentNames.filter((name) =>
    knownLocalAgentKeys.has(name),
  );
  if (collisions.length > 0) {
    throw new Error(
      `demoAgentNames collide with existing Mastra local agents: ${collisions.join(", ")}`,
    );
  }

  // Track every resourceId we hand out so we can fail loudly if two demos
  // accidentally share one (would cause cross-demo working-memory contamination).
  const resourceIdByAgent = new Map<string, string>();
  resourceIdByAgent.set("weatherAgent", weatherResourceId);
  // `getLocalAgents` above calls every local agent with the baseline
  // `weatherResourceId`. For the dedicated headless-complete agent we want
  // its own bucket so its working-memory doesn't collide with weatherAgent.
  // Re-bind it under a dedicated resourceId here (the lookup below resolves
  // via `getLocalAgent`, keyed by agentId).
  resourceIdByAgent.set(
    "headlessCompleteAgent",
    "mastra-headlessCompleteAgent",
  );
  resourceIdByAgent.set(
    "sharedStateReadWriteAgent",
    "mastra-sharedStateReadWriteAgent",
  );
  resourceIdByAgent.set(
    "subagentsSupervisorAgent",
    "mastra-subagentsSupervisorAgent",
  );
  resourceIdByAgent.set("interruptAgent", "mastra-interruptAgent");
  resourceIdByAgent.set("multimodalAgent", "mastra-multimodalAgent");
  resourceIdByAgent.set("mcpAppsAgent", "mastra-mcpAppsAgent");
  resourceIdByAgent.set("byocHashbrownAgent", "mastra-byocHashbrownAgent");

  const demoAliases: Record<
    string,
    NonNullable<ReturnType<typeof getLocalAgent>>
  > = {};
  for (const name of demoAgentNames) {
    const resourceId = `mastra-${name}`;
    const agentId = demoAgentIdOverrides[name] ?? "weatherAgent";
    const agent = getLocalAgent({
      mastra: mastraInstance,
      agentId,
      resourceId,
    });
    if (!agent) {
      throw new Error(
        `getLocalAgent returned null for ${name} (agentId="${agentId}")`,
      );
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

  // Belt-and-suspenders: we already threw above on any collision between
  // demo alias names and locally-registered Mastra agent names, so in
  // practice neither spread can clobber the other. We still spread
  // `localAgents` LAST as a defensive fallback — if the collision guard is
  // ever weakened in a future refactor, the real Mastra-registered agent
  // (here, `weatherAgent`) wins over any accidental demo-alias of the same
  // name. Removing either half of this (the collision check OR the spread
  // order) leaves us one edit away from a silent shadowing bug.
  return {
    ...demoAliases,
    ...localAgents,
  } as BuiltAgents;
}

// RUNTIME ASSUMPTION: This module assumes the Next.js App Router Node runtime
// (not Edge). `cachedAgents` is a module-scoped singleton; in Node the module
// is evaluated once per server process, so the cache lives for the lifetime
// of the process. Under Edge runtime the module could be re-evaluated per
// request in some deployments, defeating memoization — if we ever switch this
// route to `export const runtime = "edge"`, revisit this cache.
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

// Emit a structured error log with a correlation id. Extracted so every
// failure path uses an identical shape — operators grep for `errorId`
// regardless of where the failure occurred. Phases:
//   - "setup": everything that happens BEFORE headers flush. Covers agent
//     cache construction, runtime instantiation, and synchronous failures
//     inside `wrapStreamingResponse` (malformed Response from handleRequest,
//     etc.) — all of which still allow us to return a 500 JSON envelope.
//   - "stream": mid-stream failures observed by the body wrapper AFTER
//     headers have been committed — we can no longer change the status, only
//     log.
// Returns the generated errorId so callers can include it in client-facing
// responses when appropriate.
function logRouteError(err: unknown, phase: "setup" | "stream"): string {
  const error = err instanceof Error ? err : new Error(String(err));
  const errorId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      phase,
      errorId,
      message: error.message,
      stack: error.stack,
    }),
  );
  return errorId;
}

// Wrap a streaming Response body with a TransformStream that forwards chunks
// verbatim but catches any error thrown by the upstream source AFTER headers
// have been flushed. Without this, a rejection inside handleRequest's SSE
// loop escapes every try/catch and leaves the frontend with a mute aborted
// stream — no log, no errorId, no way to correlate.
//
// We cannot turn a half-flushed 200 into a 500 (headers are already out) but
// we CAN guarantee the failure is logged server-side with the same errorId
// shape as the pre-stream path. Operators grepping logs for the errorId
// pattern will find both classes of failure.
function wrapStreamingResponse(response: Response): Response {
  // Non-streaming (or empty) responses pass through untouched.
  if (!response.body) {
    return response;
  }

  const source = response.body;
  const monitored = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        // The frontend will see an aborted stream regardless; our job is to
        // leave a server-side breadcrumb with a correlation id.
        logRouteError(err, "stream");
        try {
          controller.error(err);
        } catch {
          // controller already errored/closed — nothing more to do.
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // lock already released
        }
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    },
  });

  return new Response(monitored, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Next.js App Router POST handler for CopilotKit runtime requests. Wraps the
// runtime's handler so three classes of failure are logged with a
// correlation id:
//   1. Synchronous construction errors (bad mastra config, missing
//      weatherAgent, etc.) — caught by the outer try/catch, 500 returned.
//   2. Synchronous wrap-time errors (e.g. malformed Response from
//      handleRequest that makes `wrapStreamingResponse` itself throw) —
//      caught separately so we can cancel the upstream body before the 500
//      goes out. Without this cancel, the ReadableStream returned by
//      handleRequest leaks (no consumer ever reads it).
//   3. Mid-stream errors (thrown after response headers have been flushed)
//      — caught inside the TransformStream in `wrapStreamingResponse`.
export const POST = async (req: NextRequest) => {
  let response: Response | undefined;
  try {
    const runtime = new CopilotRuntime({
      agents: getAgents(),
    });

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime,
      serviceAdapter,
      endpoint: "/api/copilotkit",
    });

    response = await handleRequest(req);
  } catch (err) {
    const errorId = logRouteError(err, "setup");
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }

  try {
    return wrapStreamingResponse(response);
  } catch (err) {
    // `wrapStreamingResponse` threw synchronously (e.g. malformed
    // `response.headers`). The upstream ReadableStream has been produced
    // but nobody is going to consume it — cancel it explicitly to release
    // whatever resources the runtime holds open behind the body. Swallow
    // errors from cancel itself; we're already on the 500 path.
    try {
      await response.body?.cancel();
    } catch {
      // best-effort cleanup; the primary error is already being logged below
    }
    const errorId = logRouteError(err, "setup");
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};
