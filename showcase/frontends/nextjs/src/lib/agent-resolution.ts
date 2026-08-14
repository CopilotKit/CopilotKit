/**
 * Manifest-driven resolution for the three unified API routes.
 *
 * Everything in this file is PURE over its inputs (manifest + env record) so
 * the separator conventions — the place a silent 404 hides — can be asserted
 * in unit tests without a server, a container, or a backend.
 *
 * The routes that consume it:
 *   src/app/api/[integration]/[demo]/[[...slug]]/route.ts  (generic)
 *   src/app/api/[integration]/auth/[[...slug]]/route.ts    (bearer gate)
 *   src/app/api/[integration]/voice/[[...slug]]/route.ts   (transcription)
 */

import {
  listIntegrations,
  resolveDemoSupport,
} from "@/lib/integration-support";
import type {
  DemoSupport,
  IntegrationManifest,
  ManifestDemo,
} from "@/lib/integration-support";
import { DEMO_RUNTIME_OPTIONS } from "@/lib/demo-runtime-options";
import type { RuntimeOptions } from "@/lib/demo-runtime-options";

/* -------------------------------------------------------------------------
 * Manifest shapes this module consumes.
 *
 * `integration-support.ts` models only the fields the PAGE tree needs. These
 * interfaces widen it with the agent/runtime fields defined in
 * showcase/shared/manifest.schema.json. They are strict subtypes, so a
 * narrow manifest can be downcast to them.
 * ---------------------------------------------------------------------- */

/**
 * Every `agent_kind` this resolver can serve.
 *
 * A RUNTIME list, not only a type. `agent_kind` arrives from YAML, so nothing
 * checks it before this module reads it: a typo'd `langraph` used to fall
 * through every `===` comparison and land on the `http` arm, where the base
 * URL of a LangGraph deployment answers on `/` and `agent.graph` is dropped
 * without a word. `isAgentKind` is what makes the typo loud.
 */
export const AGENT_KINDS = ["http", "langgraph", "in-process"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

/** Whether a manifest's `agent_kind` names a kind this resolver implements. */
export function isAgentKind(value: unknown): value is AgentKind {
  return (
    typeof value === "string" &&
    (AGENT_KINDS as readonly string[]).includes(value)
  );
}

export interface ManifestDemoAgent {
  /** LangGraph graph id. Only valid when `agent_kind: langgraph`. */
  graph?: string;
  /** URL sub-path appended VERBATIM to the agent base URL. */
  path?: string;
  /** Agent name override. Defaults to the demo id. */
  name?: string;
  /**
   * Free-form AGENT-CONSTRUCTION options for this demo, e.g.
   * `{ recursion_limit: 25 }`. The per-demo override of the
   * integration-wide `agent_defaults`.
   *
   * This is NOT `runtime`. `runtime` is handed to `new CopilotRuntime()`
   * with no filtering, so an agent-construction option placed there is
   * silently dropped.
   */
  config?: Record<string, unknown>;
}

export interface AgentManifestDemo extends ManifestDemo {
  agent?: ManifestDemoAgent;
  runtime?: RuntimeOptions;
  /**
   * A shell command this demo displays instead of running an agent (only
   * `cli-start` today). Such a row has no `route` and no `agent`, which is what
   * makes `resolveDemoSupport` call it `informational` — see the note BELOW
   * `resolveAgentName` (the "THERE IS NO `isInformationalDemo` HERE ANY MORE"
   * block, just above `resolveDemoRequest`) for why that rule lives THERE and
   * not here.
   */
  command?: string;
}

export interface AgentIntegrationManifest extends IntegrationManifest {
  /**
   * `string`, not `AgentKind`, ON PURPOSE. The value comes from YAML, so the
   * type is a claim about the manifest, not a guarantee about the data. Typing
   * it as the union would let a reader believe a typo is impossible.
   * `resolveAgentTarget` validates it with `isAgentKind`.
   */
  agent_kind?: string;
  /**
   * NOT CONSUMED. Present only so the field is visible in this type.
   * See `resolveAgentBaseUrl` for why it must never drive resolution.
   */
  agent_url_env?: string;
  agent_defaults?: Record<string, unknown>;
  /**
   * Demo ids whose AGENT CANNOT EMIT AG-UI `REASONING_*` EVENTS, so this app
   * synthesises them. See `needsSyntheticReasoning` and `src/lib/reasoning-shim.ts`.
   */
  synthetic_reasoning_demos?: readonly string[];
  demos?: AgentManifestDemo[];
}

/* -------------------------------------------------------------------------
 * Environment
 * ---------------------------------------------------------------------- */

export type EnvRecord = Record<string, string | undefined>;

/**
 * The per-integration environment variable the UNIFIED app receives, e.g.
 * `langgraph-python` -> `AGENT_URL_LANGGRAPH_PYTHON`.
 *
 * See the `frontend-nextjs` service in showcase/docker-compose.local.yml:
 * the app is handed one such variable per integration, each pointing at that
 * integration's AGENT process (ports are NOT uniform — :8000 for most,
 * including mastra, :8123 for the three LangGraph cells, and :10000 for
 * built-in-agent).
 *
 * `AGENT_URL_BUILT_IN_AGENT` is INERT: built-in-agent is `agent_kind:
 * in-process`, so `resolveAgentTarget` short-circuits before any base-URL
 * lookup and nothing ever reads that variable. Compose still sets it, so the
 * value is listed here for the reader, not because it is dialled.
 */
export function integrationAgentUrlEnvVar(slug: string): string {
  return `AGENT_URL_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

/**
 * Resolve an integration's agent BASE url.
 *
 * `AGENT_URL_<SLUG_UPPER_SNAKE>` IS THE ONLY SOURCE. Unset -> `null`, which
 * the routes turn into a 404 `{ error: "unconfigured" }`. There is no
 * fallback and no second name.
 *
 * DO NOT "fix" this by reading `manifest.agent_url_env`. That field is a
 * HISTORICAL ANNOTATION: it records which variable an integration's OWN
 * Next.js app used to read, so a reader can trace where a value came from.
 * It cannot drive resolution here, because a single value cannot describe
 * one integration. langgraph-fastapi is the proof — its canonical route
 * reads `AGENT_URL` while about a dozen of its per-demo routes read
 * `LANGGRAPH_DEPLOYMENT_URL`. Wiring `agent_url_env` into this resolver
 * would send some of that integration's demos to the wrong base URL.
 *
 * Under the one-variable rule the conflict simply does not exist: both
 * historical names collapse onto `AGENT_URL_LANGGRAPH_FASTAPI`. (They
 * already point at the same destination today — both routes hard-code the
 * same `http://localhost:8123` fallback and neither variable is set in the
 * compose file, so the split is cosmetic drift inside one container, not two
 * backends.)
 */
export function resolveAgentBaseUrl(
  slug: string,
  env: EnvRecord,
): string | null {
  return env[integrationAgentUrlEnvVar(slug)] || null;
}

/**
 * Join an agent base URL with a demo's optional sub-path.
 *
 * - The BASE is normalised: exactly one trailing slash is stripped. Every
 *   `AGENT_URL_*` variable is operator-supplied and writing a base URL with
 *   a trailing slash is common, so without this `http://ag2:8000/` produces
 *   `http://ag2:8000//agent-config` (a 404) or `http://ag2:8000//` (a
 *   body-dropping redirect). Only ONE slash is stripped, so a deliberate
 *   `http://x//` still says what it says.
 * - `path` given  -> CONCATENATED VERBATIM onto the normalised base. No
 *   collapsing, no adding slashes. The manifests encode each framework's
 *   real mount spelling (`/subagents/agui` for agno, `/subagents/run` for
 *   spring-ai, `/open_gen_ui` snake_case for google-adk) and "helpfully"
 *   rewriting any of them produces a silent 404.
 *   A bare `"/"` is a legal path and is likewise concatenated verbatim, so
 *   it lands on the same string as the absent-path rule below. No manifest
 *   uses it today; every root-agent integration relies on omitting `path`.
 * - `path` absent -> base plus EXACTLY ONE trailing slash. FastAPI, Spring
 *   and ASP.NET mounts answer the slashless form with a 307, and a 307 DROPS
 *   THE POST BODY, so the demo hangs instead of failing loudly.
 */
export function joinAgentUrl(base: string, path?: string): string {
  const normalised = base.endsWith("/") ? base.slice(0, -1) : base;
  return path ? `${normalised}${path}` : `${normalised}/`;
}

/* -------------------------------------------------------------------------
 * `${VAR}` / `${VAR:-default}` interpolation
 * ---------------------------------------------------------------------- */

/**
 * `${VAR}`, `${VAR:-default}` and `${VAR-default}`.
 *
 * Group 2 is the colon (`":"` or `""`) and exists ONLY when a default was
 * written, so `fallback === undefined` distinguishes "bare `${VAR}`" from
 * "`${VAR:-}` with an empty default".
 *
 * THOSE THREE FORMS ARE THE WHOLE SUPPORTED GRAMMAR. A NESTED placeholder in
 * the default — `${A:-${B}}` — is NOT supported and is mis-parsed rather than
 * rejected: `([^}]*)` cannot span the inner `}`, so the match ends at
 * `${A:-${B}` and the default expands to the LITERAL text `${B}`, with `B`
 * never collected in `unresolved`. No manifest uses the form. Do not add one
 * without teaching this regex (or a small parser) to balance braces; the
 * failure it produces today is silent, which is why it is written down here.
 */
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?)-([^}]*))?\}/g;

/**
 * Expand shell-style placeholders inside one string, POSIX parameter-expansion
 * semantics. THE EMPTY-STRING QUESTION IS ANSWERED HERE, EXPLICITLY:
 *
 *   `${VAR:-d}`  d when VAR is unset OR empty. The `:` means "or empty",
 *                exactly as in sh. This is what every manifest writes today.
 *   `${VAR-d}`   d ONLY when VAR is unset. An empty VAR expands to empty.
 *                Use this form when empty is a deliberate value — several
 *                frameworks disable a feature by setting its variable empty.
 *   `${VAR}`     the value, EMPTY INCLUDED. An empty VAR is a value, not an
 *                omission. An UNSET VAR is drift: it expands to `""` and its
 *                name is collected in `unresolved`, so the caller can fail
 *                the request instead of handing an empty credential to a
 *                provider and reading the 401 three layers down.
 *
 * Pass `unresolved` to collect the names of bare, unset placeholders. Without
 * it the expansion is unchanged but the drift is invisible — only tests and
 * throwaway callers should omit it.
 */
export function interpolateString(
  value: string,
  env: EnvRecord,
  unresolved?: Set<string>,
): string {
  return value.replace(
    PLACEHOLDER,
    (_match, name: string, colon?: string, fallback?: string) => {
      // `env` may be `process.env` or a literal; an unguarded index would let
      // `${constructor}` resolve to a function off the prototype chain.
      const fromEnv = Object.hasOwn(env, name) ? env[name] : undefined;

      if (fallback !== undefined) {
        const treatEmptyAsUnset = colon === ":";
        if (fromEnv === undefined) return fallback;
        if (treatEmptyAsUnset && fromEnv === "") return fallback;
        return fromEnv;
      }

      if (fromEnv === undefined) {
        unresolved?.add(name);
        return "";
      }
      return fromEnv;
    },
  );
}

/**
 * A manifest whose YAML aliases make a value contain itself.
 *
 * A DISTINCT ERROR TYPE, because the diagnosis is the structure, not the load.
 * `yaml` resolves `&anchor` / `*alias` into real object references, and it
 * accepts a self-reference — `a: &x { self: *x }` parses into an object whose
 * `self` IS the object. Left undetected, `interpolateEnvPlaceholders` recurses
 * until the stack overflows and the caller answers a `RangeError` as
 * "manifest_load_failed", which names loading rather than the cycle; and
 * `handlerCacheKey`'s `JSON.stringify` would throw its own unguarded
 * "circular structure" `TypeError` on the same input if resolution ever
 * stopped recursing first. Detecting it here makes ONE named failure out of
 * two unnamed ones. No manifest in the repo does this today.
 */
export class ManifestCycleError extends Error {
  constructor(path: string) {
    super(
      `Manifest value at ${path} contains itself. A YAML anchor/alias pair ` +
        `(&anchor … *alias) resolves to a real object reference, and this one ` +
        `points back at an enclosing value, so the tree is infinitely deep ` +
        `and cannot be expanded or fingerprinted. Replace the alias with a ` +
        `literal copy, or move the shared block so it is not its own ancestor.`,
    );
    this.name = "ManifestCycleError";
  }
}

/**
 * Walk a runtime-option tree and expand every placeholder found in a string
 * leaf. Objects and arrays are rebuilt; every other leaf is returned as is.
 *
 * `unresolved`, when given, collects the names of bare `${VAR}` placeholders
 * whose variable is unset anywhere in the tree.
 *
 * Throws `ManifestCycleError` when a container is its own ancestor. The guard
 * tracks ANCESTORS only (each container is removed on the way out), so a
 * repeated non-cyclic alias — the ordinary `&defaults` / `*defaults` reuse a
 * manifest may legitimately write in several places — is still expanded every
 * time it appears rather than being mistaken for a cycle.
 */
export function interpolateEnvPlaceholders<T>(
  value: T,
  env: EnvRecord,
  unresolved?: Set<string>,
): T {
  return interpolateNode(value, env, unresolved, new Set<object>(), "<root>");
}

function interpolateNode<T>(
  value: T,
  env: EnvRecord,
  unresolved: Set<string> | undefined,
  ancestors: Set<object>,
  path: string,
): T {
  if (typeof value === "string") {
    return interpolateString(value, env, unresolved) as unknown as T;
  }

  const isContainer = Array.isArray(value) || isPlainObject(value);
  if (!isContainer) return value;

  const container = value as unknown as object;
  if (ancestors.has(container)) throw new ManifestCycleError(path);
  ancestors.add(container);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        interpolateNode(item, env, unresolved, ancestors, `${path}[${index}]`),
      ) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      // `defineProperty`, not `out[key] = …`: a manifest key of `__proto__`
      // would otherwise invoke the inherited setter and mutate the object's
      // prototype instead of adding a key.
      defineOwn(
        out,
        key,
        interpolateNode(item, env, unresolved, ancestors, `${path}.${key}`),
      );
    }
    return out as unknown as T;
  } finally {
    // On the way OUT, so the set holds ancestors rather than every node seen.
    ancestors.delete(container);
  }
}

/* -------------------------------------------------------------------------
 * Two-level runtime-option merge
 * ---------------------------------------------------------------------- */

/**
 * Assign an OWN data property, never through a setter.
 *
 * Manifest YAML supplies these keys, so `out[key] = value` with
 * `key === "__proto__"` calls `Object.prototype`'s inherited setter: the key
 * vanishes and the object's prototype is replaced instead. `defineProperty`
 * writes the key as written, every time.
 */
function defineOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/**
 * Merge a demo's manifest runtime overrides onto the shared per-demo
 * defaults, TWO LEVELS DEEP.
 *
 * Level 1 = the option group (`a2ui`, `mcpApps`, `openGenerativeUI`, ...).
 * Level 2 = the keys inside one group; these are merged, so a manifest that
 * overrides only `a2ui.injectA2UITool` KEEPS the default
 * `a2ui.defaultCatalogId`. A shallow spread drops the catalog id and the
 * page renders "Catalog not found" — an error that looks like a model
 * problem and costs a day to trace.
 *
 * Merging STOPS at level 2. A value inside an option group replaces
 * wholesale; it is not merged recursively. Arrays always replace, never
 * concatenate (an `mcpApps.servers` override means "these servers", not
 * "these as well as the defaults").
 *
 * The copy is SHALLOW at level 1: a group `base` supplies and `override`
 * never mentions is ALIASED, not cloned, so it is still the module-level
 * constant shared by every demo that uses that default. Nothing may mutate a
 * merged group in place. `demo-runtime-options.ts` deep-freezes those
 * constants so an attempt throws instead of corrupting a second demo, and
 * `interpolateEnvPlaceholders` rebuilds the tree afterwards anyway.
 */
export function mergeRuntimeOptions(
  base: RuntimeOptions | undefined,
  override: RuntimeOptions | undefined,
): RuntimeOptions {
  // Spread, not assignment, so a `__proto__` key stays a key.
  const merged: RuntimeOptions = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    const existing = Object.hasOwn(merged, key) ? merged[key] : undefined;
    defineOwn(
      merged,
      key,
      isPlainObject(existing) && isPlainObject(value)
        ? { ...existing, ...value }
        : value,
    );
  }
  return merged;
}

/* -------------------------------------------------------------------------
 * Agent-construction config
 * ---------------------------------------------------------------------- */

/**
 * Merge the integration-wide `agent_defaults` with this demo's
 * `agent.config`. The demo wins, key by key.
 *
 * These are AGENT-CONSTRUCTION options, kept strictly apart from
 * `demos[].runtime`, which is CopilotRuntime options and is forwarded to
 * `new CopilotRuntime()` with no filtering at all. `recursion_limit` is the
 * worked example: it is LangGraph's per-run limit and reaches the graph
 * through `LangGraphAgent.assistantConfig`, so a copy of it under `runtime`
 * would be handed to CopilotRuntime and silently dropped. The manifests
 * encode `agent_defaults.recursion_limit: 100` plus
 * `agent.config.recursion_limit: 25` on the demos that used to have a
 * dedicated route (those ran at langchain_core's own default of 25).
 *
 * One level deep, like the rest of this file's merges: a value replaces
 * wholesale rather than being merged recursively.
 */
export function mergeAgentConfig(
  defaults: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...defaults, ...override };
}

export interface ResolvedDemoOptions {
  /** Options destined for the AGENT constructor (LangGraph: assistantConfig). */
  agentConfig: Record<string, unknown>;
  /** Options destined for `new CopilotRuntime()`, unfiltered. */
  runtimeOptions: RuntimeOptions;
  /**
   * Names of bare `${VAR}` placeholders whose variable is unset. Sorted.
   * Non-empty means the request must fail: an unset credential expanded to
   * `""` reaches the provider and comes back as a 401 with no trace of the
   * missing variable.
   */
  unresolvedPlaceholders: string[];
}

/* -------------------------------------------------------------------------
 * Whole-request resolution
 * ---------------------------------------------------------------------- */

export type AgentTarget =
  | { kind: "http"; url: string }
  | { kind: "langgraph"; deploymentUrl: string; graphId?: string }
  | { kind: "in-process" }
  | { kind: "unconfigured"; envVar: string }
  /** The manifest says something this resolver cannot honour. Never dialled. */
  | { kind: "misconfigured"; message: string };

/**
 * Resolve where this (integration, demo) pair's agent lives.
 *
 * `in-process` never dials a URL, so it short-circuits before the base-URL
 * lookup. `langgraph` uses the base URL VERBATIM as the deployment URL — the
 * LangGraph client owns its own path scheme, so the trailing-slash rule that
 * protects FastAPI mounts does not apply and must not be applied.
 *
 * A field this resolver cannot honour is REJECTED, not dropped: `agent.path`
 * under `agent_kind: langgraph` has no destination (the LangGraph client
 * builds its own paths), `agent.graph` under any non-LangGraph kind has
 * nowhere to go, an `agent.path` that does not start with `/` cannot be
 * appended to a base URL, and silently ignoring any of them would leave a
 * manifest author reading a line that does nothing — or, worse, a line that
 * dials the wrong URL.
 *
 * An `agent_kind` OUTSIDE the union is rejected by the same rule, and it is
 * the sharpest case of all. `agent_kind` is YAML, so a typo (`langraph`) used
 * to miss every `===` comparison and fall through to the `http` arm. For the
 * three LangGraph integrations that base URL IS a LangGraph deployment: it
 * answers on `/`, `agent.graph` is dropped, and the demo fails as if the
 * model were wrong.
 *
 * `${VAR}` IS EXPANDED IN ALL THREE STRINGS THIS FUNCTION DIALS — `agent.path`,
 * `agent.graph` and the agent base URL — with the same
 * `interpolateString` / `unresolved` machinery `resolveDemoOptions` uses for
 * `agentConfig` and `runtimeOptions`. It used to be expanded in those two and
 * NOT here, so two adjacent fields on the same manifest row behaved in opposite
 * ways and nothing said so: `agent: { path: "/agents/${TENANT}/run" }` sent the
 * literal `${` to the backend and came back as a 404 from the agent framework,
 * and `graph: "${GRAPH_ID}"` as a LangGraph "graph not found" — neither naming
 * the unexpanded variable. Pass `unresolved` (as `resolveDemoRequest` does) so
 * an unset bare placeholder joins the loud 500 instead of dialling `""`.
 *
 * Validation runs on the EXPANDED value, because that is what is dialled:
 * `path: "${PREFIX}/x"` with `PREFIX=/api` is a legal `/api/x`, and the same
 * line with `PREFIX` unset expands to `/x`... or, for `path: "${PREFIX}"`, to
 * `""` — which the leading-slash arm then rejects by name.
 */
export function resolveAgentTarget(
  manifest: AgentIntegrationManifest,
  demo: AgentManifestDemo | undefined,
  env: EnvRecord,
  unresolved?: Set<string>,
): AgentTarget {
  const declared = manifest.agent_kind;
  if (declared !== undefined && !isAgentKind(declared)) {
    return {
      kind: "misconfigured",
      message:
        `Integration ${JSON.stringify(manifest.slug)} declares agent_kind: ` +
        `${JSON.stringify(declared)}, which this app does not implement. Use ` +
        `one of ${AGENT_KINDS.join(", ")}, or omit agent_kind for the default ` +
        `(http). Fix showcase/integrations/${manifest.slug}/manifest.yaml.`,
    };
  }
  // Only `undefined` survives the guard above besides a real kind, so this
  // reads as "absent means http". The second `isAgentKind` call is what proves
  // that to the type checker.
  const kind: AgentKind = isAgentKind(declared) ? declared : "http";

  // `!== undefined`, not truthiness. `path: ""` is a line that does nothing,
  // and this file's stance is that such a line is a defect: under a truthiness
  // test an empty path escapes this arm entirely and, under `http`, silently
  // becomes `<base>/` — the root-agent failure again, indistinguishable from
  // having written no `path` at all.
  const declaredPath =
    demo?.agent?.path === undefined
      ? undefined
      : interpolateString(demo.agent.path, env, unresolved);
  if (declaredPath !== undefined && kind !== "http") {
    return {
      kind: "misconfigured",
      message:
        `Demo ${JSON.stringify(demo?.id)} on ${JSON.stringify(manifest.slug)} ` +
        `declares agent.path ${JSON.stringify(declaredPath)}, but the ` +
        `integration is agent_kind: ${kind}, which dials no sub-path. ` +
        `Remove agent.path or change agent_kind.`,
    };
  }

  // The mirror image of the arm above, and the same doctrine — including the
  // `!== undefined` test: only the LangGraph client takes a graph id, so a
  // graph under `http` or `in-process` has nowhere to go. It used to be
  // dropped in silence.
  const declaredGraph =
    demo?.agent?.graph === undefined
      ? undefined
      : interpolateString(demo.agent.graph, env, unresolved);
  if (declaredGraph !== undefined && kind !== "langgraph") {
    return {
      kind: "misconfigured",
      message:
        `Demo ${JSON.stringify(demo?.id)} on ${JSON.stringify(manifest.slug)} ` +
        `declares agent.graph ${JSON.stringify(declaredGraph)}, but the ` +
        `integration is agent_kind: ${kind}, which runs no LangGraph graph. ` +
        `Remove agent.graph or change agent_kind.`,
    };
  }

  // Only `http` reaches here with a path, and `joinAgentUrl` concatenates it
  // VERBATIM — that is the deliberate rule, because each framework's real
  // mount spelling has to survive. The cost of verbatim is that a path missing
  // its leading slash produces `http://agno:8000subagents/agui`, which fails
  // deep inside `HttpAgent` with a URL error instead of here with a named
  // reason. showcase/shared/manifest.schema.json already says `"pattern":
  // "^/"`, but the schema does not run at request time and the resolver is
  // what actually joins the two halves.
  if (declaredPath !== undefined && !declaredPath.startsWith("/")) {
    return {
      kind: "misconfigured",
      message:
        `Demo ${JSON.stringify(demo?.id)} on ${JSON.stringify(manifest.slug)} ` +
        `declares agent.path ${JSON.stringify(declaredPath)}, which does not ` +
        `start with "/". It is appended to the agent base URL verbatim, so ` +
        `this would dial <base>${declaredPath} — a URL that fails inside the ` +
        `agent client rather than here. Add the leading slash in ` +
        `showcase/integrations/${manifest.slug}/manifest.yaml.`,
    };
  }

  if (kind === "in-process") return { kind: "in-process" };

  // The base URL is operator-supplied, so it is the likeliest of the three to
  // still hold a `${...}` — an unexpanded compose or Railway reference. It is
  // expanded here and re-tested for emptiness: `AGENT_URL_X=${MISSING}` expands
  // to `""`, and reporting that as `unconfigured` (naming the variable) beats
  // dialling `"/"`.
  const declaredBase = resolveAgentBaseUrl(manifest.slug, env);
  const base =
    declaredBase === null
      ? null
      : interpolateString(declaredBase, env, unresolved) || null;
  if (!base) {
    return {
      kind: "unconfigured",
      envVar: integrationAgentUrlEnvVar(manifest.slug),
    };
  }

  if (kind === "langgraph") {
    return { kind: "langgraph", deploymentUrl: base, graphId: declaredGraph };
  }
  return { kind: "http", url: joinAgentUrl(base, declaredPath) };
}

/**
 * Agent name this demo registers under: the manifest override, else the demo
 * id.
 *
 * The demo-id fallback is only safe because `resolveDemoRequest` refuses a
 * demo with no `demos[]` entry. With an entry present, `agent.name` absent
 * means the manifest deliberately says "the name is the demo id"; without
 * one it would mean "nobody said", and the id would be dialled against a
 * backend that may not know it.
 */
export function resolveAgentName(
  demoId: string,
  demo: AgentManifestDemo | undefined,
): string {
  return demo?.agent?.name ?? demoId;
}

/**
 * Whether THIS demo's agent needs the synthetic reasoning shim.
 *
 * THE SIGNAL IS A MANIFEST FIELD, AND IT HAD TO BE. The shim must fire for the
 * agents that cannot emit `REASONING_*` events and for NOTHING else — applied
 * to `langgraph-python`, `mastra` or `ms-agent-python`, whose backends do emit
 * them, it duplicates every reasoning bubble. Nothing already in the tree
 * distinguishes the two groups: `agent_kind` is `http` for both, and
 * `not_supported_features` says the opposite thing (these cells DO work, via
 * the shim). The two other candidates were both rejected for concrete reasons —
 * "does this slug still have a per-integration route" is invisible in the
 * deployed image (it stages manifests only, per `SHOWCASE_INTEGRATIONS_DIR`)
 * and would evaporate the moment the route is deleted; and `getCapabilities()`
 * on `AbstractAgent` (which does carry a `reasoning.supported` flag) is async,
 * so consulting it would put an `await` inside the handler cache's
 * lookup-through-store — which `demo-runtime.ts` forbids in writing, and the
 * .NET host does not implement it anyway.
 *
 * `!== undefined`-free membership test on purpose: an absent list, an empty
 * list and a list that does not name this demo all mean the same thing (no
 * shim), and there is no third state worth distinguishing.
 *
 * PER DEMO, not per integration, even though the incapacity belongs to the
 * whole .NET host: `ms-agent-dotnet`'s own route shimmed exactly its three
 * reasoning cells, because the extra events break
 * `tool-rendering-default-catchall`'s spec.
 */
export function needsSyntheticReasoning(
  manifest: AgentIntegrationManifest,
  demoId: string,
): boolean {
  return manifest.synthetic_reasoning_demos?.includes(demoId) ?? false;
}

/**
 * Final runtime + agent options for one (integration, demo) pair.
 *
 * Two INDEPENDENT tracks, and keeping them independent is the point:
 *
 *   - runtime: shared per-demo defaults, then the manifest's
 *     `demos[].runtime` on top (two levels deep). Every key survives —
 *     there is no filtering, so an option this app has never heard of
 *     still reaches CopilotRuntime.
 *   - agent: the integration's `agent_defaults`, then the demo's
 *     `agent.config` on top. Integration-wide defaults sit UNDER the
 *     per-demo values so a demo can lower `recursion_limit` from the
 *     integration's 100 to 25.
 *
 * Both tracks get `${VAR}` expansion.
 *
 * `unresolved` is the SHARED report. `resolveDemoRequest` passes the same set to
 * `resolveAgentTarget` first, so `unresolvedPlaceholders` below covers the agent
 * target's `${VAR}`s as well as these two tracks' — one report for every
 * placeholder in the resolution, which is what the caller's 500 promises.
 */
export function resolveDemoOptions(
  demoId: string,
  manifest: AgentIntegrationManifest,
  demo: AgentManifestDemo | undefined,
  env: EnvRecord,
  unresolved: Set<string> = new Set<string>(),
): ResolvedDemoOptions {
  const runtimeOptions = mergeRuntimeOptions(
    // `hasOwn`, not a bare index: a demo id of `constructor` or `toString`
    // would otherwise pull a function off `Object.prototype` and hand it to
    // the merge as if it were a defaults table.
    Object.hasOwn(DEMO_RUNTIME_OPTIONS, demoId)
      ? DEMO_RUNTIME_OPTIONS[demoId]
      : undefined,
    demo?.runtime,
  );
  const agentConfig = mergeAgentConfig(
    manifest.agent_defaults,
    demo?.agent?.config,
  );
  return {
    agentConfig: interpolateEnvPlaceholders(agentConfig, env, unresolved),
    runtimeOptions: interpolateEnvPlaceholders(runtimeOptions, env, unresolved),
    unresolvedPlaceholders: [...unresolved].sort(),
  };
}

export interface ResolvedDemo {
  demoId: string;
  manifest: AgentIntegrationManifest;
  /** Never `undefined`: a supported demo with no entry fails resolution. */
  demo: AgentManifestDemo;
  agentName: string;
  target: AgentTarget;
  agentConfig: Record<string, unknown>;
  runtimeOptions: RuntimeOptions;
  /**
   * Whether the agent for this demo needs the synthetic reasoning shim.
   *
   * REQUIRED, not optional: it decides whether events are injected into a
   * demo's stream, and an optional flag would let a crafted resolution omit it
   * and mean "no" without saying so. Computed by
   * {@link needsSyntheticReasoning}; consumed by `demo-runtime.ts`, which also
   * folds it into the handler cache key.
   */
  injectSyntheticReasoning: boolean;
  /** @see ResolvedDemoOptions.unresolvedPlaceholders */
  unresolvedPlaceholders: string[];
}

/** The two failing arms of `DemoSupport`; both carry a `reason`. */
export type UnservableDemo = Exclude<DemoSupport, { kind: "supported" }>;

export type DemoResolution =
  | { ok: true; resolved: ResolvedDemo }
  | { ok: false; support: UnservableDemo };

/*
 * THERE IS NO `isInformationalDemo` HERE ANY MORE, AND THERE MUST NOT BE ONE.
 *
 * `resolveDemoSupport` in `integration-support.ts` owns the rule — which is
 * what its own docstring claims, and what makes the page tree and the API
 * routes agree about `cli-start`. It returns `supported` only when the id is
 * under `features`, a `demos[]` row exists, AND `(row.route || row.agent)`.
 * `resolveDemoRequest` returns early on any non-`supported` kind, so an
 * `!route && !agent` test on the SAME row (duplicate ids are rejected by
 * `assertManifest`, so it is provably the same row) is the exact complement of
 * a condition that has already been checked: it could never be true.
 *
 * Keeping it was worse than dead code. It answered `kind: "malformed"`, which
 * `demo-runtime.ts` maps to `error: "not_found"` — while that file now has a
 * dedicated `"informational"` code precisely so a caller switching on `error`
 * can tell an unsupported cell from a cell that never had a runnable surface.
 * So the one arm that NAMED an informational demo reported it under the wrong
 * code. Its old justification ("without this arm `POST /api/<slug>/cli-start`
 * reached the LangGraph branch and was told to add `demos[].agent.graph`") was
 * true before `resolveDemoSupport` gained its informational arm, and is not any
 * more.
 */

/**
 * Full lookup for an API request. Returns `ok: false` for an unknown slug, an
 * unknown demo id, a demo this integration does not support, a demo it claims to
 * support but does not describe, or an INFORMATIONAL demo (no `route` and no
 * `agent`, so no agent serves it) — the routes turn all five into a 404 JSON
 * body.
 *
 * THOSE FIVE VERDICTS SHARE THREE `error` CODES, not five.
 * `demo-runtime.ts` maps `DemoSupport.kind` straight through: `malformed` ->
 * `not_found`, `informational` -> `informational`, everything else ->
 * `not_supported`. So an unknown slug and an unknown demo id are
 * INDISTINGUISHABLE to a caller switching on `error` (both `not_found`), as are
 * a manifest that claims support without describing the demo and a plain
 * unsupported cell (both `not_supported`). Only `informational` has a code to
 * itself. Widen the codes only in `demo-runtime.ts`, and only deliberately —
 * the D6 probes read them.
 *
 * EVERY ONE of those five verdicts is `resolveDemoSupport`'s, reached through the
 * single early return below. This function adds no unservability rule of its own;
 * the one it used to carry (`isInformationalDemo`) had become the exact
 * complement of a condition `resolveDemoSupport` already checks, and reported it
 * under the wrong code. See the note BELOW `resolveAgentName`, just above this
 * docstring.
 *
 * Note the deliberate difference from the PAGE tree, which renders a
 * "not available" cell instead of 404ing: a page 404 breaks shell links,
 * whereas an API 404 is the honest answer to "run this agent" when no such
 * agent exists.
 *
 * `manifests` exists so a behavioural rule can be asserted against a SYNTHETIC
 * manifest. Pinning one to a real manifest's live drift makes the test fail the
 * moment someone performs the repair the error message asks for.
 */
export function resolveDemoRequest(
  slug: string,
  demoId: string,
  env: EnvRecord = process.env,
  manifests: readonly IntegrationManifest[] = listIntegrations(),
): DemoResolution {
  const support = resolveDemoSupport(slug, demoId, manifests);
  if (support.kind !== "supported") return { ok: false, support };

  const manifest = manifests.find((entry) => entry.slug === slug) as
    | AgentIntegrationManifest
    | undefined;
  if (!manifest) {
    return {
      ok: false,
      support: {
        kind: "malformed",
        reason: `Unknown Showcase integration ${JSON.stringify(slug)}.`,
      },
    };
  }

  const demo = manifest.demos?.find((entry) => entry.id === demoId);
  if (!demo) {
    // DEFENCE IN DEPTH. `resolveDemoSupport` now refuses to call a `features`
    // id with no `demos[]` row supported, so this is unreachable through the
    // call above — but the types cannot prove `demo` exists, and the failure
    // it guards is the expensive one: with no entry there is no `agent.path`,
    // so `joinAgentUrl` produces `<base>/` and the request reaches the
    // integration's ROOT agent. That agent answers, streams text, and renders
    // the wrong demo — the failure that looks like a model problem and costs a
    // day. `agent.name` is lost the same way, so an in-process integration
    // looks up a builder under a name its manifest never meant.
    return {
      ok: false,
      support: {
        kind: "malformed",
        reason:
          `Manifest drift: ${JSON.stringify(manifest.slug)} lists ` +
          `${JSON.stringify(demoId)} under features but has no demos[] entry ` +
          `for it, so there is nothing to say which agent serves it. Add the ` +
          `entry to showcase/integrations/${manifest.slug}/manifest.yaml, or ` +
          `drop the id from features.`,
      },
    };
  }

  // ONE `unresolved` set for BOTH tracks. `resolveAgentTarget` interpolates
  // `agent.path`, `agent.graph` and the agent base URL, and its unset bare
  // `${VAR}` names have to reach the same report the option tracks feed, or the
  // caller's 500 would name only half the drift. Target first, so its names are
  // already in the set when `resolveDemoOptions` snapshots it.
  const unresolved = new Set<string>();
  const target = resolveAgentTarget(manifest, demo, env, unresolved);
  const { agentConfig, runtimeOptions, unresolvedPlaceholders } =
    resolveDemoOptions(demoId, manifest, demo, env, unresolved);

  return {
    ok: true,
    resolved: {
      demoId,
      manifest,
      demo,
      agentName: resolveAgentName(demoId, demo),
      target,
      agentConfig,
      runtimeOptions,
      injectSyntheticReasoning: needsSyntheticReasoning(manifest, demoId),
      unresolvedPlaceholders,
    },
  };
}
