/**
 * Builds a CopilotKit runtime for ONE (integration, demo) pair.
 *
 * ONE RUNTIME PER DEMO, NEVER ONE PER APP
 * ---------------------------------------
 * This is the whole reason the 20 integrations could collapse from 339 route
 * files to three. Runtime option flags are properties of the runtime
 * INSTANCE, not of the request: `get-runtime-info.ts` computes
 * `openGenerativeUIEnabled` off the instance, so a shared runtime would let
 * one demo's `openGenerativeUI` / `a2ui` / `mcpApps` flags leak into every
 * other demo answered by the same route. The old topology worked around that
 * by giving each flag combination its own file. A runtime carrying only THIS
 * demo's options is what makes one file safe instead.
 *
 * ...BUT NOT ONE PER REQUEST
 * --------------------------
 * `createCopilotRuntimeHandler` fires `fireInstanceCreatedTelemetry` on its
 * first line, and that helper is documented as "called once per handler
 * factory invocation (not per request)". The 339 routes this replaces built
 * their handler once at module load, so the event counted deployments.
 * Building one per request would fire it for every `/info`, `/run`,
 * `/connect` and `/transcribe` across 20 integrations — under D6 probe
 * fan-out that is a flood of outbound traffic and a meaningless event count.
 *
 * So the handler (and the runtime and agent inside it) is MEMOISED per
 * distinct resolution: the cache key is the calling route's id, the slug, the
 * demo id, the base path, a fingerprint of everything resolution produced
 * (target, agent name, runtime options, agent config), `LANGSMITH_API_KEY`
 * (the one input the agent reads outside resolution) and the IDENTITY of the
 * `hooks` / `runtimeExtras` objects the route contributed. Resolution itself
 * still runs per request — it is pure and cheap — so an env change lands on a
 * new key instead of being served stale.
 *
 * A FAILED build is memoised too, as a message rather than a handler. The
 * telemetry event fires on the factory's first line, so a construction that
 * throws after it would otherwise re-fire the event on every retry — the flood
 * again, just reached by the error path. See `CachedBuild`.
 *
 * PER-DEMO ISOLATION NOW COMES FROM THE CACHE KEY, NOT FROM PER-REQUEST
 * CONSTRUCTION. Nothing here is built per request any more. Two demos never
 * share a key, so one demo's option flags can still never reach another's
 * runtime, but that guarantee is the key's job now. Anything that weakens the
 * key weakens the isolation.
 *
 * WHAT A CALLER MUST DO:
 *  - Pass a `routeId` that names the ROUTE FILE. Two routes can compute the
 *    same `basePath` (`/api/<slug>/auth` is reachable from both the `auth`
 *    route and the generic `[demo]` route), and a gate-less handler written
 *    into the slot the auth route reads is an authentication bypass.
 *  - Hoist `hooks` and `runtimeExtras` to MODULE-LEVEL constants. They are
 *    part of the key by object identity, so a fresh object per request means
 *    a fresh handler per request — the telemetry flood this memoisation
 *    exists to prevent, back again and silent.
 *  - Never let either capture anything request-specific. They are captured on
 *    the FIRST request for a key and reused. Both current callers are safe by
 *    construction — the auth gate reads its `request` from its own argument,
 *    and the voice route hands over a process-wide singleton.
 */

import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { HttpAgent } from "@ag-ui/client";

import { ManifestCycleError, resolveDemoRequest } from "@/lib/agent-resolution";
import type { ResolvedDemo } from "@/lib/agent-resolution";
import { resetIntegrationsCacheForTests } from "@/lib/integration-support";
import type { RuntimeOptions } from "@/lib/demo-runtime-options";
import {
  getInProcessAgentFactory,
  withInProcessRequestScope,
} from "@/lib/in-process-agents";
import { applySyntheticReasoning } from "@/lib/reasoning-shim";

type HandlerOptions = Parameters<typeof createCopilotRuntimeHandler>[0];
export type RuntimeHooks = HandlerOptions["hooks"];

/**
 * Which wire protocol a route's handler speaks. Must match the transport the
 * PAGE's provider selected, because nothing negotiates between them.
 *
 *  - `"single-route"` — one `POST <basePath>` carrying a JSON envelope
 *    (`{ method, params, body }`). `resolveSingleRoute` dispatches on
 *    `method`; the base path itself is the only URL.
 *  - `"multi-route"` — URL sub-paths under the base path: `GET /info`,
 *    `POST /agent/:id/run`, `POST /transcribe`, `/threads/*`, `/memories/*`.
 *    The base path itself matches NOTHING and answers 404.
 *
 * A MISMATCH IS SILENT. `matchRoute` cannot match a bare base path, so a
 * single-route client aimed at a multi-route handler gets
 * `404 {"error":"Not found"}` with no log line and an empty chat — which reads
 * as a dead backend rather than as a protocol mismatch. That exact pairing is
 * what broke every demo in this app once already.
 */
export type RuntimeMode = NonNullable<HandlerOptions["mode"]>;

/** Extra CopilotRuntime options a specialised route contributes in code. */
export type RuntimeExtras = Record<string, unknown>;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * CopilotRuntime options this route OWNS, so a manifest may not set them.
 *
 * `demos[].runtime` is a deliberate unfiltered pass-through — an option this
 * app has never heard of must still reach CopilotRuntime — and that has a
 * sharp edge. `runtime: { agents: … }` would replace the agent map built
 * from the resolved target, and every request would then 404 on the agent
 * id. `runtime: { channels: … }` is worse: `CopilotSseRuntime`'s constructor
 * throws on it and the route 500s with a stack trace instead of a reason.
 */
const RESERVED_RUNTIME_KEYS = [
  "agents",
  "runner",
  "intelligence",
  "channels",
] as const;

function reservedRuntimeKeys(options: RuntimeOptions): string[] {
  return RESERVED_RUNTIME_KEYS.filter((key) => Object.hasOwn(options, key));
}

/**
 * Reject a resolution this route cannot serve HONESTLY, before any agent or
 * runtime is built. Returns `null` when there is nothing wrong.
 *
 * Each arm here is a value that would otherwise be accepted and then quietly
 * lost or overridden — the class of bug the whole manifest split exists to
 * prevent.
 */
function validateResolved(resolved: ResolvedDemo): Response | null {
  const { manifest, demoId, unresolvedPlaceholders, runtimeOptions, target } =
    resolved;

  if (unresolvedPlaceholders.length > 0) {
    // A bare `${OPENAI_API_KEY}` with the variable unset expands to `""`.
    // Left alone it travels all the way to the provider and returns a 401
    // that names nothing. Fail here, naming the variables.
    return json(
      {
        error: "misconfigured",
        message:
          `Unresolved placeholders in ${manifest.slug}/${demoId}: ` +
          `${unresolvedPlaceholders.join(", ")}. Set the variables, or give ` +
          `each placeholder a default (\${VAR:-fallback}).`,
      },
      500,
    );
  }

  const reserved = reservedRuntimeKeys(runtimeOptions);
  if (reserved.length > 0) {
    return json(
      {
        error: "misconfigured",
        message:
          `Demo "${demoId}" on "${manifest.slug}" sets reserved ` +
          `CopilotRuntime option(s) under demos[].runtime: ` +
          `${reserved.join(", ")}. This route owns them. Remove them from ` +
          `showcase/integrations/${manifest.slug}/manifest.yaml.`,
      },
      500,
    );
  }

  // `agent_defaults` / `agent.config` are AGENT-CONSTRUCTION options, and
  // only the LangGraph agent has somewhere to put them (assistantConfig).
  // An http or in-process integration that adds one would have it dropped
  // without a word — precisely the silent loss the runtime/agent-config
  // split exists to prevent.
  if (
    Object.keys(resolved.agentConfig).length > 0 &&
    (target.kind === "http" || target.kind === "in-process")
  ) {
    return json(
      {
        error: "misconfigured",
        message:
          `"${manifest.slug}" is agent_kind: ${manifest.agent_kind ?? "http"}, ` +
          `which carries no agent-construction options, but demo "${demoId}" ` +
          `resolves agent config keys ` +
          `${Object.keys(resolved.agentConfig).sort().join(", ")}. They would ` +
          `be dropped. Remove agent_defaults / demos[].agent.config, or move ` +
          `the values to demos[].runtime if they are CopilotRuntime options.`,
      },
      500,
    );
  }

  // The reasoning shim wraps ONE agent implementation: it rewrites the run
  // input and interleaves events on the way back, which only `HttpAgent` (an
  // AG-UI stream this app owns both ends of) can carry here. A LangGraph or
  // in-process integration that listed a demo under
  // `synthetic_reasoning_demos` would have the whole field dropped without a
  // word — the same silent loss the `agent_defaults` arm above exists to
  // prevent, and worse to diagnose, because the cell renders and merely never
  // shows a reasoning bubble.
  if (
    resolved.injectSyntheticReasoning &&
    (target.kind === "langgraph" || target.kind === "in-process")
  ) {
    return json(
      {
        error: "misconfigured",
        message:
          `"${manifest.slug}" lists demo "${demoId}" under ` +
          `synthetic_reasoning_demos, but the integration is agent_kind: ` +
          `${manifest.agent_kind ?? "http"}, which this app cannot apply the ` +
          `reasoning shim to (it wraps an http AG-UI agent). Remove the id ` +
          `from showcase/integrations/${manifest.slug}/manifest.yaml, or make ` +
          `the backend emit REASONING_* events itself.`,
      },
      500,
    );
  }

  return null;
}

/**
 * Stamp `demos[].runtime.a2ui.injectA2UITool` onto every LangGraph run.
 *
 * `@ag-ui/a2ui-middleware` only writes `forwardedProps.injectA2UITool` when
 * the flag is truthy (`run` → `injectToolAndFlag`). `LangGraphAgent` then
 * copies that field to `state["ag-ui"].inject_a2ui_tool`. An explicit
 * `false` (a2ui-recovery, a2ui-fixed-schema) never left the middleware, so
 * the graph saw "no signal" instead of the manifest value. The clone copies
 * this middleware (`AbstractAgent.clone` copies `middlewares`).
 */
function stampLangGraphInjectA2UITool(
  agent: InstanceType<typeof LangGraphAgent>,
  runtimeOptions: RuntimeOptions,
): void {
  const a2ui = runtimeOptions.a2ui;
  if (typeof a2ui !== "object" || a2ui === null || Array.isArray(a2ui)) {
    return;
  }
  if (!Object.hasOwn(a2ui, "injectA2UITool")) return;
  const flag = (a2ui as { injectA2UITool: unknown }).injectA2UITool;
  if (typeof flag !== "boolean" && typeof flag !== "string") return;
  agent.use((input, next) =>
    next.run({
      ...input,
      forwardedProps: {
        ...(typeof input.forwardedProps === "object" &&
        input.forwardedProps !== null
          ? input.forwardedProps
          : {}),
        injectA2UITool: flag,
      },
    }),
  );
}

/** Logged once per process, not once per request. */
let langsmithKeyWarned = false;

/**
 * The last manifest-load failure message that was logged.
 *
 * SAME DISCIPLINE AS `langsmithKeyWarned`, for the same reason and a worse
 * blast radius. `listIntegrations` deliberately does not cache a failure
 * permanently — an operator fixing `SHOWCASE_INTEGRATIONS_DIR` must not need a
 * restart — so the likeliest deployment misconfiguration there is re-throws on
 * every request. Logging the full error each time turns D6's fan-out (20
 * integrations x 3 routes, plus the layout and the placeholder page per render)
 * into a stack-trace flood that buries every other line in the log.
 *
 * The message is remembered rather than a boolean, so a CHANGED fault still
 * speaks: a wrong path, then a malformed YAML, then a different malformed YAML
 * each log once. Reset by `resetDemoRuntimeState`.
 */
let lastManifestFailureLogged: string | null = null;

/**
 * Build the agent for a resolved demo, or a Response explaining why we
 * cannot. Never returns a stand-in agent: a wrong backend that answers is
 * worse than an honest error.
 */
function buildAgent(
  resolved: ResolvedDemo,
): { agent: unknown } | { error: Response } {
  const { target, manifest, agentName, agentConfig, demoId } = resolved;

  switch (target.kind) {
    case "misconfigured":
      return {
        error: json({ error: "misconfigured", message: target.message }, 500),
      };

    case "unconfigured":
      return {
        error: json(
          {
            error: "unconfigured",
            message:
              `No agent URL for integration "${manifest.slug}". ` +
              `Set ${target.envVar} to that integration's agent base URL.`,
          },
          404,
        ),
      };

    case "in-process": {
      const factory = getInProcessAgentFactory(manifest.slug);
      if (!factory) {
        return {
          error: json(
            {
              error: "not_implemented",
              message:
                `Integration "${manifest.slug}" declares agent_kind: in-process, ` +
                `but this app carries no in-process agent factory for it. ` +
                `The agent factory tree (src/lib/factory/*) has not been ported ` +
                `from showcase/integrations/${manifest.slug} yet. Register it in ` +
                `src/lib/in-process-agents.ts.`,
            },
            501,
          ),
        };
      }
      return { agent: factory({ slug: manifest.slug, demoId, agentName }) };
    }

    case "langgraph": {
      if (!target.graphId) {
        return {
          error: json(
            {
              error: "misconfigured",
              message:
                `Demo "${demoId}" on LangGraph integration ` +
                `"${manifest.slug}" declares no agent.graph, so there is no ` +
                `graph id to run. Add demos[].agent.graph to its manifest.yaml.`,
            },
            500,
          ),
        };
      }
      // `agentConfig` is `agent_defaults` merged with this demo's
      // `agent.config` — agent-construction options, never CopilotRuntime
      // options. For LangGraph they travel as `assistantConfig`: its own
      // `recursion_limit` default is 25 and `with_config` does not
      // propagate through the server's runs API, so the limit has to ride
      // along on every run this route starts.
      const langsmithApiKey = process.env.LANGSMITH_API_KEY || "";
      if (!langsmithApiKey && !langsmithKeyWarned) {
        langsmithKeyWarned = true;
        // Empty is a legal value here — LangGraph runs fine without tracing.
        // Say so once, because the alternative is a deployment where traces
        // simply never appear and nothing ever explains why.
        console.warn(
          "[demo-runtime] LANGSMITH_API_KEY is not set. LangGraph agents run " +
            "without LangSmith tracing; no runs will appear in LangSmith.",
        );
      }
      const agent = new LangGraphAgent({
        deploymentUrl: target.deploymentUrl,
        graphId: target.graphId,
        langsmithApiKey,
        ...(Object.keys(agentConfig).length > 0
          ? { assistantConfig: agentConfig }
          : {}),
      } as ConstructorParameters<typeof LangGraphAgent>[0]);
      // A2UIMiddleware only writes forwardedProps.injectA2UITool when the
      // flag is truthy. LangGraphAgent copies that field onto
      // state["ag-ui"].inject_a2ui_tool. Stamp an explicit false here so a
      // backend-owned generate_a2ui (a2ui-recovery) is not left as
      // "no signal" on the Python side.
      stampLangGraphInjectA2UITool(agent, resolved.runtimeOptions);
      return { agent };
    }

    case "http": {
      const agent = new HttpAgent({ url: target.url });
      // The shim is a property of the BACKEND's event vocabulary, so it is
      // applied to the constructed agent rather than being a runtime option:
      // it rewrites the agent's own inbound input and outbound event stream.
      // Only `http` can carry it — `validateResolved` rejects the flag on any
      // other kind rather than letting it be dropped here in silence.
      return {
        agent: resolved.injectSyntheticReasoning
          ? applySyntheticReasoning(agent)
          : agent,
      };
    }
  }
}

export interface DemoRequestOptions {
  /**
   * Which ROUTE FILE is calling, e.g. `"generic"`, `"auth"`, `"voice"`.
   *
   * Part of the cache key, and load-bearing for more than tidiness: `hooks`
   * and `runtimeExtras` are baked into the memoised handler and cannot be
   * fingerprinted by value, while `basePath` does not identify the route
   * (`/api/<slug>/auth` is what both the auth route and the generic route with
   * `demo === "auth"` compute). Without this, one route can write its handler
   * into the slot another route reads — and for the auth demo that is a
   * gate-less handler answering with no bearer check.
   */
  routeId: string;
  slug: string;
  demoId: string;
  /** `/api/<slug>/<demoId>`; the runtime router dispatches beneath it. */
  basePath: string;
  /**
   * The wire protocol THIS ROUTE FILE serves. See {@link RuntimeMode}.
   *
   * REQUIRED, and deliberately so: it has no default. Every route file must
   * state the protocol it speaks next to the pages it serves, because the
   * correct answer differs per route and a wrong one fails silently (404 with
   * an empty chat, nothing logged). A default here would let a NEW route file
   * inherit whichever value happened to suit the others and 404 in production;
   * as a required field, forgetting it is a compile error.
   *
   * How to pick it: read the demo page's provider props.
   *   - page sets `useSingleEndpoint={false}` -> `"multi-route"`
   *   - page sets nothing                     -> `"single-route"`
   * `invariant: server mode matches the pages' transport` in
   * `demo-runtime.test.ts` asserts this mapping against the pages on disk, so
   * a new page that opts out without a matching route entry goes red.
   */
  mode: RuntimeMode;
  /**
   * Options a specialised route adds in code (e.g. a transcription service).
   * MUST be a module-level constant: it joins the cache key by identity.
   */
  runtimeExtras?: RuntimeExtras;
  /**
   * Lifecycle hooks a specialised route adds in code (e.g. the auth gate).
   * MUST be a module-level constant: it joins the cache key by identity.
   */
  hooks?: RuntimeHooks;
}

type DemoHandler = ReturnType<typeof createCopilotRuntimeHandler>;

/**
 * One memoised build: the handler, or the reason building it failed.
 *
 * THE FAILURE VARIANT IS NOT AN OPTIMISATION, IT IS THE POINT.
 * `createCopilotRuntimeHandler` fires `fireInstanceCreatedTelemetry` on its
 * FIRST line. A throw anywhere after that returns no handler, so without a
 * negative entry the next request would re-enter the same construction and
 * re-fire the event — per request, for as long as the misconfiguration lives.
 * That is precisely the flood this memoisation exists to prevent, and a broken
 * manifest is exactly when a route is hammered by D6 probe retries.
 *
 * Caching the failure is sound because a build is a pure function of its key:
 * everything that could change the outcome (the resolved target, the options,
 * the env-interpolated values) is already IN the key, so a fixed manifest or a
 * changed variable lands on a different key rather than on this entry. The
 * MESSAGE is stored, never the `Response`: a `Response` body can be read once,
 * so a cached one would serve an empty body from the second request on.
 */
type CachedBuild =
  | { kind: "handler"; handler: DemoHandler }
  | { kind: "failed"; error: string; message: string };

/**
 * Handler (and its runtime and agent) per distinct resolution.
 *
 * The manifests bound the LEGITIMATE key space: about 20 integrations x 40
 * demos x 3 routes, so ~2400 entries in a deployment where every cell is
 * exercised. They do NOT bound it absolutely — the fingerprint includes
 * `${VAR}`-interpolated values, so a placeholder carrying per-request or
 * per-tenant data would mint a key per distinct value and grow without limit.
 * Hence the explicit cap below: it makes the memory ceiling a property of this
 * file rather than of what a future manifest happens to interpolate.
 */
const handlerCache = new Map<string, CachedBuild>();

/**
 * Hard ceiling on cached handlers, with headroom over the ~2400 legitimate
 * (route, slug, demo) resolutions.
 *
 * Eviction costs a REBUILD (and one extra telemetry event), never
 * correctness — a handler is a pure function of its key. Insertion-order FIFO,
 * not LRU: the fingerprint is stable per deployment, so anything that reaches
 * the cap is churn from mutable interpolated values, and evicting the oldest
 * is the right answer for that shape.
 */
export const HANDLER_CACHE_MAX = 4096;

/** Test-only: how many handlers are currently memoised. */
export function handlerCacheSizeForTests(): number {
  return handlerCache.size;
}

/**
 * Drop everything THIS MODULE remembers between requests: the handler cache,
 * the object-identity tokens that feed its key, the once-per-process LangSmith
 * warning, the last-logged manifest-load failure, and the manifest cache
 * resolution reads through (successes and the short negative window alike).
 *
 * The token table and its counter are reset TOGETHER, never one without the
 * other. Resetting the counter alone would hand a fresh object the number an
 * older, still-live object already holds, and two objects with one token is a
 * cache-key collision between two routes' hooks — the failure the token exists
 * to prevent.
 *
 * NOT RESET, because it does not live here: the voice route's module-level
 * `runtimeExtras` singleton. It holds no env-derived state a test can observe
 * (it constructs its OpenAI client once and reads `OPENAI_API_KEY` there), and
 * its identity only has to be STABLE, which surviving a reset satisfies.
 *
 * FOR TESTS ONLY. A test that stubs an env var or re-mocks
 * `createCopilotRuntimeHandler` must call this first, or it is served the
 * handler the previous test built. The manifest cache is included because
 * `SHOWCASE_INTEGRATIONS_DIR` is an env var like any other: leaving it cached
 * would serve a test the manifest tree the previous test pointed at.
 */
export function resetDemoRuntimeState(): void {
  handlerCache.clear();
  objectTokens = new WeakMap();
  nextObjectToken = 0;
  langsmithKeyWarned = false;
  lastManifestFailureLogged = null;
  // Clears the SUCCESS cache and the short-lived negative cache together. A
  // test that stubs `SHOWCASE_INTEGRATIONS_DIR` after a failed load would
  // otherwise be re-thrown the previous test's error for a whole TTL window.
  resetIntegrationsCacheForTests();
}

/**
 * Everything the handler is built from, so a change lands on a new key.
 *
 * One `JSON.stringify` over the whole tuple rather than joining on a
 * separator: JSON already delimits its members unambiguously, so there is no
 * separator to pick and no way for a component containing the separator to
 * collide two distinct resolutions onto one key.
 *
 * Do NOT reintroduce a separator by writing a raw control byte into this
 * source. An earlier revision embedded a literal NUL here, which made the file
 * report as binary to `file`, `grep` and `git diff` — silently dropping it out
 * of code review and every repo-wide grep, while still compiling and passing
 * every test.
 */
function handlerCacheKey(
  resolved: ResolvedDemo,
  options: DemoRequestOptions,
): string {
  return JSON.stringify([
    options.routeId,
    resolved.manifest.slug,
    resolved.demoId,
    options.basePath,
    // The handler is built from this, so it belongs here. `routeId` already
    // discriminates the current callers (mode is a per-route-file constant), so
    // this adds no entries in practice — it is here so the key stays a complete
    // fingerprint of the build rather than one that happens to be adequate.
    options.mode,
    resolved.target,
    resolved.agentName,
    resolved.runtimeOptions,
    resolved.agentConfig,
    // The agent is BUILT differently when this is true (an extra middleware
    // rewriting its input and its event stream), so it belongs in the
    // fingerprint like every other build input. It is derived from the manifest
    // rather than from the four fields above, so none of them covers it: a
    // manifest edit that only adds or removes an id under
    // `synthetic_reasoning_demos` lands on the same key as before, and the
    // cached handler would keep the old shim state for the life of the process.
    resolved.injectSyntheticReasoning,
    // The ONE input that resolution does not produce. `buildAgent` reads
    // `LANGSMITH_API_KEY` straight from `process.env` and bakes it into the
    // LangGraph agent, so leaving it out would make this module's promise ("an
    // env change lands on a new key instead of being served stale") false for
    // exactly one variable — a documented invariant with an undocumented
    // exception. It is read unconditionally rather than only for the langgraph
    // target: a per-deployment constant costs nothing in the key, and a
    // condition here would have to be kept in step with `buildAgent` by hand.
    process.env.LANGSMITH_API_KEY ?? null,
    // `hooks` and `runtimeExtras` hold functions and class instances, so they
    // cannot be fingerprinted by value — but they ARE baked into the handler,
    // so leaving them out of the key would let one route be served another
    // route's handler. Identity is the only sound fingerprint available.
    objectToken(options.hooks),
    objectToken(options.runtimeExtras),
  ]);
}

/**
 * A stable number per object, so object IDENTITY can take part in a string
 * cache key.
 *
 * `WeakMap`, so a token never keeps a route's hooks object alive on its own.
 * A caller that builds a fresh object per request gets a fresh token per
 * request and therefore a fresh handler — which is why `DemoRequestOptions`
 * requires these to be module-level constants.
 */
let objectTokens = new WeakMap<object, number>();
let nextObjectToken = 0;

function objectToken(value: object | undefined): number | null {
  if (!value) return null;
  let token = objectTokens.get(value);
  if (token === undefined) {
    token = ++nextObjectToken;
    objectTokens.set(value, token);
  }
  return token;
}

/** Memoise a build, evicting the oldest entry once the cap is reached. */
function cacheBuild(key: string, build: CachedBuild): void {
  if (handlerCache.size >= HANDLER_CACHE_MAX) {
    // Map iteration order is insertion order, so this is the oldest key.
    const oldest = handlerCache.keys().next().value;
    if (oldest !== undefined) handlerCache.delete(oldest);
  }
  handlerCache.set(key, build);
}

/**
 * Resolve, build and serve one request. Every route in this app funnels
 * through here so the resolution rules stay in exactly one place.
 */
export async function handleDemoRequest(
  req: Request,
  options: DemoRequestOptions,
): Promise<Response> {
  const { slug, demoId, basePath, mode, runtimeExtras, hooks } = options;

  let resolution: ReturnType<typeof resolveDemoRequest>;
  try {
    resolution = resolveDemoRequest(slug, demoId);
  } catch (error) {
    // `resolveDemoRequest` reads the manifest tree, which throws
    // `ManifestLoadError` for an unset or wrong `SHOWCASE_INTEGRATIONS_DIR`,
    // malformed YAML, or an image that staged nothing. That is the likeliest
    // deployment misconfiguration there is, and its message was written for an
    // operator to read. Uncaught it becomes Next's generic 500 HTML page: the
    // message is discarded and the D6 probes get an unparseable body.
    const message = error instanceof Error ? error.message : String(error);
    // A SEPARATE CODE for a self-referencing manifest value, because "load
    // failed" names the wrong thing: the file loaded and parsed fine, and the
    // defect is that a YAML alias makes a value its own ancestor. Reporting it
    // as a load failure sends the reader to `SHOWCASE_INTEGRATIONS_DIR` and the
    // YAML syntax, neither of which is wrong. Detecting it in resolution also
    // keeps it away from `handlerCacheKey`, whose `JSON.stringify` would throw
    // its own unguarded "circular structure" `TypeError` outside every arm here.
    const code =
      error instanceof ManifestCycleError
        ? "manifest_cycle"
        : "manifest_load_failed";
    // RATE-LIMITED BY MESSAGE, not by request. See
    // `lastManifestFailureLogged`. The RESPONSE still carries the full message
    // every time — the caller always gets the diagnosis; only the log is
    // deduplicated.
    if (lastManifestFailureLogged !== message) {
      lastManifestFailureLogged = message;
      console.error(
        `[demo-runtime] failed to load the manifests for ${slug}/${demoId} ` +
          `(logged once per distinct message; the response carries it every ` +
          `time):`,
        error,
      );
    }
    return json({ error: code, message }, 500);
  }

  if (!resolution.ok) {
    // One arm per DemoSupport kind, named explicitly rather than letting two
    // of them fall through to a shared `else`. `informational` is NOT
    // "not supported": the integration supports the feature, the feature just
    // has no runnable surface (`cli-start` is a copy-paste CLI command with a
    // `command` and no `route`). Reporting it as not-supported is the same
    // false claim the page tree was carrying, and a caller that switches on
    // `error` deserves to be able to tell the two apart.
    const error =
      resolution.support.kind === "malformed"
        ? "not_found"
        : resolution.support.kind === "informational"
          ? "informational"
          : "not_supported";
    return json({ error, message: resolution.support.reason }, 404);
  }

  const resolved = resolution.resolved;
  const invalid = validateResolved(resolved);
  if (invalid) return invalid;

  const cacheKey = handlerCacheKey(resolved, options);
  let cached = handlerCache.get(cacheKey);

  // THE LOOKUP-THROUGH-STORE BELOW MUST STAY SYNCHRONOUS. `buildAgent`, `new
  // CopilotRuntime()` and `createCopilotRuntimeHandler` are all synchronous, so
  // there is no `await` between `handlerCache.get` and `cacheBuild`, and a
  // single-threaded runtime therefore cannot interleave two concurrent
  // requests inside it: the first request to a cold key always stores its entry
  // before the second can look the key up. That is what makes the plain
  // `CachedBuild` value sound instead of a `Promise<CachedBuild>`.
  //
  // Insert an `await` anywhere between them and that stops being true: under D6
  // probe fan-out several first requests for one key would each build a
  // handler, each firing `fireInstanceCreatedTelemetry`, and all but one handler
  // would be discarded — the flood this memoisation exists to prevent, silently
  // reintroduced. If a future agent or runtime constructor must be awaited,
  // store the in-flight promise in the map instead. `handler memoisation`'s
  // concurrent-request test pins the current behaviour.
  if (!cached) {
    let built: ReturnType<typeof buildAgent>;
    try {
      built = buildAgent(resolved);
    } catch (error) {
      // An in-process factory throws BY DESIGN when the manifest and
      // `BUILT_IN_AGENT_BUILDERS` have drifted, and that message is the whole
      // diagnosis. Uncaught it becomes Next's generic 500 HTML page, so the
      // caller sees neither the message nor the `{error, message}` shape every
      // other arm returns.
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[demo-runtime] failed to build the agent for ${slug}/${demoId}:`,
        error,
      );
      return json({ error: "agent_build_failed", message }, 500);
    }
    if ("error" in built) return built.error;

    // THREE KEYS FOR ONE AGENT, AND ALL THREE ARE LOAD-BEARING.
    //
    //  - `resolved.agentName` is the manifest's label (`demos[].agent.name`,
    //    falling back to the demo id). It is the BUILDER key: the in-process
    //    registry looks `BUILT_IN_AGENT_BUILDERS` up by it, and that map has no
    //    catch-all, so this key must never be dropped.
    //  - `resolved.demoId` is what the PAGES actually mount. Every ported page
    //    writes `<CopilotKit agent="<demo id>">` — `demos/auth/page.tsx` sets
    //    `agent="auth"` — so the client dials `.../agent/<demo id>/run`.
    //  - `default` is for internal components that call `useAgent()` with no
    //    argument.
    //
    // The first two FREQUENTLY DIFFER (`auth` vs `auth-demo`, `agentic-chat`
    // vs `agentic_chat`, `hitl` vs `human_in_the_loop`, …). Registering only
    // the manifest label 404s every such pair: `cloneAgentForRequest` looks the
    // id up strictly and answers `{"error":"Agent not found"}` for an absent
    // one, and `default` does NOT rescue it — a client that was given an
    // `agent` prop never falls back to `default`. Computed keys collapse when
    // the two are equal, which is the common case and is harmless.
    const agents = {
      [resolved.agentName]: built.agent,
      [resolved.demoId]: built.agent,
      default: built.agent,
    };

    try {
      const runtime = new CopilotRuntime({
        ...resolved.runtimeOptions,
        ...runtimeExtras,
        // AFTER the spreads, never before. `validateResolved` already rejects a
        // manifest that names `agents`, so this is the second lock on the same
        // door: the agent map is built from the resolved target and nothing
        // downstream may replace it.
        // @ts-expect-error -- Published CopilotRuntime agents type wraps Record
        // in MaybePromise<NonEmptyRecord<...>>, which rejects a plain Record
        // built from computed keys. Fixed in source, pending release.
        agents,
      });

      cached = {
        kind: "handler",
        handler: createCopilotRuntimeHandler({
          runtime,
          basePath,
          mode,
          hooks,
        }),
      };
    } catch (error) {
      // BOTH calls are guarded, and `new CopilotRuntime()` is the likeliest
      // throw in the whole request path: `demos[].runtime` is a deliberate
      // unfiltered pass-through and `RESERVED_RUNTIME_KEYS` blocks only four
      // names, so any OTHER manifest value a CopilotRuntime validator rejects
      // (a malformed `mcpApps.servers`, a bad `a2ui` shape) throws right here.
      // Uncaught it becomes Next's generic 500 HTML page: the message is
      // discarded and the D6 probes get an unparseable body, exactly as for
      // the two neighbouring arms.
      //
      // The failure is CACHED, so `fireInstanceCreatedTelemetry` — which
      // `createCopilotRuntimeHandler` fires before it can throw — cannot be
      // re-fired once per request for the lifetime of the misconfiguration.
      // See `CachedBuild`.
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[demo-runtime] failed to build the runtime for ${slug}/${demoId}:`,
        error,
      );
      cached = { kind: "failed", error: "runtime_build_failed", message };
    }
    cacheBuild(cacheKey, cached);
  }

  if (cached.kind === "failed") {
    // A fresh `Response` per request, from the cached message: a `Response`
    // body is single-use. Logged once, at build time, not once per request.
    return json({ error: cached.error, message: cached.message }, 500);
  }

  const serve = cached.handler;
  // An in-process agent's outbound LLM call re-attaches the inbound `x-*`
  // headers (notably `x-aimock-context`) from an AsyncLocalStorage scope, and
  // the agent factory seam gets no `Request`, so the scope can only be opened
  // here. Unconditional on purpose: it is a pass-through for every slug with
  // no in-process agent, so there is no branch to get wrong. Skip it and every
  // built-in-agent fixture misses, which reads as a model failure rather than
  // as plumbing.
  try {
    return await withInProcessRequestScope(slug, req, () => serve(req));
  } catch (error) {
    // NOT cached: unlike a build, serving a request is not a pure function of
    // the cache key, so one rejection says nothing about the next. The guard is
    // here for the same reason as the others — a rejected promise out of a
    // route handler is Next's generic 500 HTML, and this is the last frame that
    // can still answer in the `{error, message}` shape every caller parses.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[demo-runtime] request failed for ${slug}/${demoId}:`,
      error,
    );
    return json({ error: "request_failed", message }, 500);
  }
}
