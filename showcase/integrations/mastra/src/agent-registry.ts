/**
 * agent-registry.ts — the single source of truth for which AG-UI agent names
 * this integration exposes and which Mastra agent each one resolves to.
 *
 * WHY THIS FILE EXISTS (packaging, not behaviour):
 * This registry used to live inside `src/app/api/copilotkit/route.ts`. It is
 * now a standalone module because TWO processes need it:
 *
 *   1. the Next.js CopilotKit route (`src/app/api/copilotkit/route.ts`), which
 *      still runs the Mastra agents IN-PROCESS exactly as before, and
 *   2. the standalone AG-UI HTTP agent server (`src/agent_server.ts`), which
 *      serves the same agents over the network so a shared frontend can reach
 *      mastra the same way it reaches the other integrations.
 *
 * Importing the registry from the route module into the agent server would
 * drag `next/server` and `@copilotkit/runtime` into a plain Node process, so
 * the registry lives here and the route re-exports it for backwards
 * compatibility (existing tests import these names from the route module).
 *
 * NOTHING about agent behaviour, prompts, tools, model config, resourceIds or
 * the collision/uniqueness guards changed in the move.
 */

import { MastraAgent, getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";

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
  // Reasoning cells. The demo pages request these agent names verbatim
  // (`agent="reasoning-default"` / `agent="reasoning-custom"`); they must be
  // registered here or the runtime returns agent-not-found and the chat never
  // starts (no reasoning stream renders). These are the agent-name equivalents
  // of the `reasoning-default-render` / `agentic-chat-reasoning` manifest
  // feature keys — see tests/vitest/demoAgentNames.parity.test.ts, which
  // enforces that every page `agent="…"` literal appears in this list.
  "reasoning-default",
  "reasoning-custom",
  "readonly-state-agent-context",
  "agent-config",
  "declarative-gen-ui",
  "a2ui-fixed-schema",
  "headless-complete",
  "tool-rendering-reasoning-chain",
  "gen-ui-interrupt",
  "interrupt-headless",
] as const;

export type DemoAgentName = (typeof demoAgentNames)[number];

/**
 * Which Mastra agent each demo alias resolves to. TOTAL, not partial: every
 * name in `demoAgentNames` MUST appear here.
 *
 * WHY TOTALITY IS ENFORCED BY THE TYPE
 * This used to be `Partial<...>` read as `demoAgentIdOverrides[name] ??
 * "weatherAgent"`. A new demo added to `demoAgentNames` and forgotten here
 * silently fell back to the generic weatherAgent — which does not register that
 * demo's tools. That is not a visible failure: the cell mounts, the chat
 * answers, and the demo's tool calls are simply uncallable, so no card renders.
 * It has already shipped once (tool-rendering + its two catch-all variants fell
 * back to weatherAgent, which lacks get_stock_price/roll_d20, so the Stock, d20
 * and Chain pills emitted uncallable tool calls and rendered nothing).
 *
 * Adding the three missing rows fixed that instance; making the map TOTAL fixes
 * the mechanism. `Record<DemoAgentName, LocalMastraAgentName>` means a new
 * `demoAgentNames` entry with no row here is a `tsc` error, not a
 * plausible-looking broken cell. A demo that genuinely wants the shared agent
 * says so explicitly with `"weatherAgent"`.
 *
 * WHY THE VALUES ARE NOT `string`
 * Totality got the KEYS that guarantee; the values were left as `string`, so a
 * typo (`"wetherAgent"`) type-checked and surfaced only at boot, as a THROW out
 * of `getLocalAgent`. The message is Mastra's, not ours:
 * `Agent with name wetherAgent not found` (a `MastraError`, id
 * `MASTRA_GET_AGENT_BY_NAME_NOT_FOUND`, raised by `Mastra#getAgent`). Quoted
 * exactly because this doc is what someone greps the logs with — an earlier
 * revision cited `getLocalAgent returned null for <demo> (agentId="…")`, a
 * string the code cannot produce, so the grep found nothing. Same class of
 * failure this doc argues must be a `tsc` error.
 * `LocalMastraAgentName` is statically pinned to Mastra's real key union (see
 * `_LocalNamesMatchMastra`), so a value that Mastra does not register now fails
 * to compile.
 */
const demoAgentIds: Record<DemoAgentName, LocalMastraAgentName> = {
  // Demos backed by the shared weatherAgent. Explicit on purpose — see above.
  agentic_chat: "weatherAgent",
  human_in_the_loop: "weatherAgent",
  "gen-ui-tool-based": "weatherAgent",
  "shared-state-read": "weatherAgent",
  "shared-state-write": "weatherAgent",
  "prebuilt-sidebar": "weatherAgent",
  "prebuilt-popup": "weatherAgent",
  "chat-slots": "weatherAgent",
  "chat-customization-css": "weatherAgent",
  "headless-simple": "weatherAgent",
  frontend_tools: "weatherAgent",
  "frontend-tools-async": "weatherAgent",
  "hitl-in-chat": "weatherAgent",
  "hitl-in-app": "weatherAgent",
  "readonly-state-agent-context": "weatherAgent",
  "agent-config": "weatherAgent",
  "declarative-gen-ui": "weatherAgent",
  "a2ui-fixed-schema": "weatherAgent",
  // Demos with a dedicated Mastra agent (own system prompt / tool set).
  "headless-complete": "headlessCompleteAgent",
  "shared-state-read-write": "sharedStateReadWriteAgent",
  "shared-state-streaming": "sharedStateStreamingAgent",
  "gen-ui-agent": "genUiAgent",
  subagents: "subagentsSupervisorAgent",
  "gen-ui-interrupt": "interruptAgent",
  "interrupt-headless": "interruptAgent",
  // Reasoning cells use a dedicated reasoning-capable agent (Responses API +
  // reasoning-summary streaming). Mapping them to the default weatherAgent
  // (a plain chat-completions model with no reasoning support) meant no
  // reasoning items were ever emitted and the reasoning slot stayed dark.
  // See src/mastra/agents/index.ts (reasoningAgent).
  "reasoning-default": "reasoningAgent",
  "reasoning-custom": "reasoningAgent",
  // Reasoning + backend tool-rendering chain: dedicated agent registers the
  // four chain tools (weather/flights/stock/dice) under the fixture tool-call
  // names so Mastra executes each leg and the multi-turn chain reaches its
  // closing narration.
  "tool-rendering-reasoning-chain": "reasoningChainAgent",
  // Plain tool-rendering + its catch-all variants share one backend bound to
  // all four demo tools (get_weather, search_flights, get_stock_price,
  // roll_d20) — mirrors gold tool_rendering_agent.py. Without this they fell
  // back to weatherAgent, which lacks get_stock_price/roll_d20, so the Stock,
  // d20, and Chain pills emitted uncallable tool calls and rendered no card.
  "tool-rendering": "toolRenderingAgent",
  "tool-rendering-default-catchall": "toolRenderingAgent",
  "tool-rendering-custom-catchall": "toolRenderingAgent",
};

/** One AG-UI agent, as `getLocalAgent` hands it back. */
type LocalAgentValue = NonNullable<ReturnType<typeof getLocalAgent>>;

// --- Compile-time plumbing for the two unions below. ---------------------
// `Equals` is the standard bidirectional-assignability trick; `Assert` turns a
// false result into a `tsc --noEmit` error at the point of declaration. These
// live in the SOURCE file on purpose: the same invariants were supposed to be
// guarded by tests/vitest/builtAgents.types.test.ts, but that file hardcodes its
// own copy of the union instead of deriving it, so it drifted independently and
// could never catch drift in `src/mastra/index.ts`. An assertion here fails in
// the same `tsc` run that compiles the code it constrains.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

/**
 * Every agent key Mastra actually registers, derived from the live `mastra`
 * instance rather than retyped. `Mastra` is generic over its `agents` record and
 * `getAgent` accepts `keyof TAgents`, so this reads the real key union out of
 * `src/mastra/index.ts`.
 */
type MastraRegisteredAgentName = Extract<
  Parameters<typeof mastra.getAgent>[0],
  string
>;

/**
 * Local-agent keys Mastra registers under — the keys handed back from
 * `MastraAgent.getLocalAgents({ mastra })`.
 *
 * This union used to be maintained by hand against `mastra.agents` in
 * `src/mastra/index.ts` with a comment promising "any agent added there must be
 * added here too". It went stale (10 listed against 20 registered) because
 * nothing enforced the promise. `_LocalNamesMatchMastra` below now does: add or
 * remove an agent in `src/mastra/index.ts` and `tsc --noEmit` fails here until
 * this union matches. The union is still written out rather than aliased to
 * `MastraRegisteredAgentName` so the names stay readable at their use sites and
 * so a `mastra` typing regression that widens the inferred record to
 * `Record<string, Agent>` is caught instead of silently swallowing everything.
 */
export type LocalMastraAgentName =
  | "weatherAgent"
  | "beautifulChatAgent"
  | "headlessCompleteAgent"
  | "sharedStateReadWriteAgent"
  | "sharedStateStreamingAgent"
  | "genUiAgent"
  | "reasoningAgent"
  | "reasoningChainAgent"
  | "toolRenderingAgent"
  | "subagentsSupervisorAgent"
  | "interruptAgent"
  | "a2uiRecoveryAgent"
  | "multimodalAgent"
  | "mcpAppsAgent"
  | "byocHashbrownAgent"
  | "browserUseAgent"
  | "backgroundAgentsAgent"
  | "observationalMemoryAgent"
  | "openGenUiAgent"
  | "openGenUiAdvancedAgent";

type _LocalNamesMatchMastra = Assert<
  Equals<LocalMastraAgentName, MastraRegisteredAgentName>
>;

/**
 * The local-agent keys `buildAgents` actually RETURNS under their own
 * working-memory bucket — a strict subset of `LocalMastraAgentName`.
 *
 * The distinction is load-bearing and is what stopped `LocalMastraAgentName`
 * from simply being widened to all 20. `BuiltAgents` must describe what a caller
 * can index: the ten agents below are built here, while the other ten are
 * reached through a demo alias or through `src/agent_server.ts`'s
 * `DEMO_ENDPOINT_BINDINGS` (which builds them with the resourceId its Next.js
 * route uses). Keying `BuiltAgents` by all 20 would type `agents.browserUseAgent`
 * as a non-null agent that is `undefined` at runtime.
 */
export type BuiltLocalAgentName =
  | "weatherAgent"
  | "headlessCompleteAgent"
  | "sharedStateReadWriteAgent"
  | "sharedStateStreamingAgent"
  | "genUiAgent"
  | "subagentsSupervisorAgent"
  | "interruptAgent"
  | "multimodalAgent"
  | "mcpAppsAgent"
  | "byocHashbrownAgent";

// A key we build but Mastra does not register would throw at boot, not at
// `tsc`. Chain the two unions so the subset relation is checked statically.
type _BuiltLocalNamesAreRegistered = Assert<
  BuiltLocalAgentName extends LocalMastraAgentName ? true : false
>;

// Narrowed agent-map type. Keys are exactly the demo aliases plus the local
// agents this registry builds; values are the non-null result of
// `getLocalAgent`. If someone drops `as const` on `demoAgentNames` or widens
// this type back to `Record<string, ...>`, the type-level test under
// tests/vitest/builtAgents.types.test.ts should break `tsc --noEmit`.
export type BuiltAgents = Record<
  DemoAgentName | BuiltLocalAgentName,
  LocalAgentValue
>;

// Baseline resourceId for weatherAgent. Kept as a named const so tests and
// future refactors don't have to hardcode the string.
const weatherResourceId = "mastra-weatherAgent";

/**
 * One local Mastra agent this registry exposes under its own name.
 *
 * WHY A TABLE AND NOT TEN HAND-WRITTEN BLOCKS
 * Each agent used to cost FIVE near-identical edits: a presence check on
 * `baseLocalAgents`, a `getLocalAgent` re-bind, a null check on that, an entry in
 * the `localAgents` literal and a `resourceIdByAgent.set`. Five edit sites is
 * exactly why `LocalMastraAgentName` rotted — a new agent lands in
 * `src/mastra/index.ts` and this file is updated partially or not at all. A row
 * per agent makes "add an agent" one edit, and the error strings below are
 * character-identical to the ones the blocks produced.
 */
interface BuiltLocalAgentSpec {
  /** Mastra registration key, also the exposed name and the resourceId suffix. */
  key: BuiltLocalAgentName;
  /**
   * Tail of the missing-agent error, after "— required for". Kept per row
   * because it names the demo that breaks, which is the actionable half of the
   * message.
   */
  requiredFor: string;
  /**
   * Re-bind onto `mastra-<key>` via `getLocalAgent` instead of keeping the
   * instance `getLocalAgents` produced.
   *
   * `getLocalAgents` applies ONE resourceId to every local agent, so without
   * this every local agent would share weatherAgent's working-memory bucket.
   * `weatherAgent` is the single row that opts out: the baseline id IS its id,
   * and re-binding it would issue an extra `getLocalAgent` call that changes
   * which instance the map exposes.
   */
  rebind: boolean;
}

// `as const satisfies` and not a plain annotation: the annotation alone would
// widen `key` back to `BuiltLocalAgentName` and make the coverage assertion
// below vacuously true.
const BUILT_LOCAL_AGENTS = [
  { key: "weatherAgent", requiredFor: "demo aliases", rebind: false },
  {
    key: "headlessCompleteAgent",
    requiredFor: "headless-complete demo alias",
    rebind: true,
  },
  {
    key: "sharedStateReadWriteAgent",
    requiredFor: "shared-state-read-write demo alias",
    rebind: true,
  },
  {
    key: "sharedStateStreamingAgent",
    requiredFor: "shared-state-streaming demo alias",
    rebind: true,
  },
  { key: "genUiAgent", requiredFor: "gen-ui-agent demo alias", rebind: true },
  {
    key: "subagentsSupervisorAgent",
    requiredFor: "subagents demo alias",
    rebind: true,
  },
  {
    key: "interruptAgent",
    requiredFor: "gen-ui-interrupt/interrupt-headless demos",
    rebind: true,
  },
  { key: "multimodalAgent", requiredFor: "/demos/multimodal", rebind: true },
  { key: "mcpAppsAgent", requiredFor: "/demos/mcp-apps", rebind: true },
  {
    key: "byocHashbrownAgent",
    requiredFor: "/demos/byoc-hashbrown",
    rebind: true,
  },
] as const satisfies readonly BuiltLocalAgentSpec[];

// The table must cover EVERY built local key. A row missing here would drop an
// agent out of `BuiltAgents` at runtime while the type still claims it, so the
// coverage is asserted statically rather than trusted.
type _TableCoversBuiltLocalNames = Assert<
  Equals<(typeof BUILT_LOCAL_AGENTS)[number]["key"], BuiltLocalAgentName>
>;

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

  // Track every resourceId we hand out so we can fail loudly if two demos
  // accidentally share one (would cause cross-demo working-memory contamination).
  const resourceIdByAgent = new Map<string, string>();
  const localAgents = {} as Record<BuiltLocalAgentName, LocalAgentValue>;

  for (const spec of BUILT_LOCAL_AGENTS) {
    const registered = baseLocalAgents[spec.key];
    if (!registered) {
      throw new Error(
        `${spec.key} missing from Mastra config — required for ${spec.requiredFor}`,
      );
    }
    if (!spec.rebind) {
      // weatherAgent only: `getLocalAgents` already bound it to the baseline id.
      localAgents[spec.key] = registered as LocalAgentValue;
      resourceIdByAgent.set(spec.key, weatherResourceId);
      continue;
    }
    const resourceId = `mastra-${spec.key}`;
    // NO `if (!agent) throw` HERE — the guard that used to sit here was dead
    // code. See the note on the identical call in the demo-alias loop below.
    const agent = getLocalAgent({
      mastra: mastraInstance,
      agentId: spec.key,
      resourceId,
    });
    localAgents[spec.key] = agent;
    resourceIdByAgent.set(spec.key, resourceId);
  }

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

  const demoAliases: Record<string, LocalAgentValue> = {};
  for (const name of demoAgentNames) {
    const resourceId = `mastra-${name}`;
    const agentId = demoAgentIds[name];
    /**
     * NO NULL GUARD. There used to be an `if (!agent) throw
     * "getLocalAgent returned null for …"` here, and it was unreachable in both
     * directions against the pinned dependency:
     *   - `@ag-ui/mastra` types `getLocalAgent` as
     *     `(options: GetLocalAgentOptions) => AbstractAgent` — not nullable —
     *     and its body ends in `return new MastraAgent({...})`, so there is no
     *     value it can return that fails a truthiness test.
     *   - The failure it was written for (an agentId Mastra does not register)
     *     THROWS instead: `Mastra#getAgent` raises a `MastraError`
     *     (`MASTRA_GET_AGENT_BY_NAME_NOT_FOUND`) reading
     *     `Agent with name <id> not found`, which propagates straight out of
     *     this loop and fails the boot with a message that already names the id.
     * Keeping the guard cost nothing at runtime but advertised a log line that
     * cannot exist, which is what sent readers grepping for the wrong string.
     * If the dependency ever widens the return type to `AbstractAgent | null`,
     * `LocalAgentValue` stops accepting it and `tsc` says so here.
     */
    const agent = getLocalAgent({
      mastra: mastraInstance,
      agentId,
      resourceId,
    });
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
// request in some deployments, defeating memoization — if we ever switch the
// copilotkit route to `export const runtime = "edge"`, revisit this cache.
let cachedAgents: BuiltAgents | null = null;
export function getAgents(): BuiltAgents {
  if (cachedAgents === null) {
    cachedAgents = buildAgents();
  }
  return cachedAgents;
}

// Test hook: reset memoized agents so unit tests can observe rebuilds.
export function __resetAgentsCacheForTests(): void {
  cachedAgents = null;
}
