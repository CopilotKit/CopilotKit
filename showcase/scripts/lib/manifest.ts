/**
 * Shared manifest schema + parser.
 *
 * Used by audit.ts, validate-parity.ts, and capture-previews.ts so the
 * three tools agree on:
 *   1. the Manifest / ManifestDemo TypeScript shape
 *   2. runtime shape validation of `manifest.yaml`
 *   3. the tagged-union return type distinguishing missing /
 *      malformed / unreadable / ok
 */

import fs from "fs";
import yaml from "yaml";

/**
 * Branded, non-empty demo id. Structurally a string (so downstream
 * callers can still use `demo.id` in template strings, `Set<string>`
 * membership, equality comparisons, etc.) but the branding prevents
 * arbitrary strings from flowing into a `DemoId` slot without going
 * through the `createDemoId` smart constructor. parseManifest is the
 * sole production caller of that constructor; it validates non-empty
 * at runtime and re-reports shape-malformed on failure.
 *
 * The `__brand` property is phantom-only — it does not exist at
 * runtime. That keeps the branded type zero-cost while still giving
 * the compiler a distinct nominal type for id values.
 */
export type DemoId = string & { readonly __brand: "DemoId" };

/**
 * Smart constructor for `DemoId`. Returns the branded value on success
 * or `null` if validation fails (non-string or empty string). Kept as
 * `null`-returning rather than throwing so `parseManifest` can turn a
 * failure into its usual `{kind:"malformed", subkind:"shape"}` result
 * without crossing an exception boundary.
 *
 * The parameter type is `unknown` — this function sits at an API
 * boundary (yaml.parse results, JSON-roundtripped demos, caller-supplied
 * strings) where the compile-time type does not hold. A widened param
 * keeps the runtime typeof guard alive rather than reducing to a dead
 * check.
 */
export function createDemoId(s: unknown): DemoId | null {
  if (typeof s !== "string" || s.length === 0) return null;
  return s as DemoId;
}

/**
 * How the shell / runtime reaches an integration's agent.
 *
 *   - "http"       — a plain AG-UI HTTP endpoint at the agent base URL.
 *                    This is the DEFAULT: a manifest that omits
 *                    `agent_kind` behaves as "http".
 *   - "langgraph"  — a LangGraph Platform / langgraph-dev server that is
 *                    addressed by graph id. Only this kind may set
 *                    `demos[].agent.graph`.
 *   - "in-process" — the agent runs inside the Next.js app, so no agent
 *                    base URL is dialled at all.
 */
export type AgentKind = "http" | "langgraph" | "in-process";

/**
 * Runtime-checkable list of the legal `agent_kind` values. Kept next to
 * the type so adding a kind is a one-line change that the compiler
 * cross-checks (`readonly AgentKind[]`) instead of two lists drifting.
 *
 * THERE ARE THREE COPIES OF THIS LIST, and each one used to describe itself
 * as "the" runtime-checkable one:
 *
 *  1. this constant;
 *  2. the `agent_kind` `enum` in showcase/shared/manifest.schema.json;
 *  3. `AGENT_KINDS` in showcase/frontends/nextjs/src/lib/agent-resolution.ts.
 *
 * (1) and (2) are now ONE list with two spellings: `generate-registry.ts`
 * imports this constant and refuses to build when the schema enum disagrees
 * with it, so a kind added here without touching the schema fails the build
 * instead of shipping. JSON cannot import TypeScript, which is why the schema
 * copy cannot simply be deleted.
 *
 * (3) is still an independent copy. It cannot import this module: this file
 * lives in the private `@copilotkit/showcase-scripts` package, which the app
 * does not depend on and the deployed image does not stage (it stages the
 * manifests only). Keep it in step by hand — it is checked at request time by
 * `isAgentKind`, which is what makes a typo'd kind loud there.
 */
export const AGENT_KINDS: readonly AgentKind[] = Object.freeze([
  "http",
  "langgraph",
  "in-process",
]);

/**
 * WHICH frontend serves an integration's demo pages.
 *
 *   - "integration" — the integration's OWN Next.js container serves
 *                     `/demos/<id>`. This is the DEFAULT: a manifest that
 *                     omits `demo_frontend` behaves as "integration".
 *   - "unified"     — the shared app at `showcase/frontends/nextjs` serves
 *                     them at `<origin>/<slug>/demos/<id>`.
 *
 * This is the SINGLE TRACKED SOURCE OF TRUTH for the unified-frontend
 * migration. It replaced two uncompared env vars
 * (`LOCAL_SERVICE_URL_<SLUG>` for compose, `SHOWCASE_UNIFIED_FRONTEND_SLUGS`
 * for the harness) plus a hardcoded URL in `control-plane-run.ts`. See the
 * `$comment` on `demo_frontend` in `showcase/shared/manifest.schema.json` for
 * the full history and the list of derived consumers.
 *
 * INDEPENDENT of `agent_kind` / agent resolution: a migrated slug's DEMOS move
 * to the unified app while its AGENT stays on its own origin. Collapsing the
 * two axes is what makes a dead agent look verified.
 */
export type DemoFrontend = "integration" | "unified";

/**
 * Runtime-checkable list of the legal `demo_frontend` values, same shape and
 * same reasoning as `AGENT_KINDS` above.
 *
 * THERE ARE THREE SPELLINGS OF THIS LIST:
 *
 *  1. this constant;
 *  2. the `demo_frontend` `enum` in showcase/shared/manifest.schema.json;
 *  3. the `"demo_frontend"` entry in `MANIFEST_KEYS` in
 *     showcase/frontends/nextjs/src/lib/integration-support.ts (the KEY, not
 *     the value list — that file validates the closed top-level key set).
 *
 * (1) and (2) are ONE list: `generate-registry.ts` calls
 * `assertSchemaDemoFrontendsMatch` and exits non-zero when they disagree, so a
 * value added here without touching the schema fails the build. (3) is pinned
 * to the schema by a both-directions set-equality test in
 * `agent-resolution.test.ts`; that app cannot import this module (see the note
 * on `AGENT_KINDS`).
 */
export const DEMO_FRONTENDS: readonly DemoFrontend[] = Object.freeze([
  "integration",
  "unified",
]);

/**
 * The value an omitted `demo_frontend` means. Unlike `agent_kind` — where the
 * parser deliberately leaves the field `undefined` so callers can tell
 * "declared http" from "did not say" — this default IS exported, because every
 * consumer of the migration state needs a CONCRETE answer for every slug: the
 * compose-roster emitter must decide whether to emit a URL, and the harness
 * must decide which origin to navigate to. A "did not say" third state there
 * is the half-migrated hole this field exists to close.
 */
export const DEFAULT_DEMO_FRONTEND: DemoFrontend = "integration";

/*
 * There is deliberately NO `DEFAULT_AGENT_URL_ENV` export here.
 *
 * It used to exist as `"AGENT_URL"`, documented as the fallback "applied by
 * consumers when `agent_url_env` is omitted". No consumer ever applied it:
 * `agent-resolution.ts` resolves `AGENT_URL_<SLUG>` and only that, and both the
 * `agent_url_env` field docstring below and its `manifest.schema.json`
 * description call the field a DEAD FIELD. A named default for a dead field is
 * worse than nothing — it reads as the live fallback and contradicts the two
 * places that say the field redirects nothing.
 */

/**
 * Per-demo agent mapping (`demos[].agent`). Every key is optional; a
 * demo that omits the whole block gets the default mapping (agent name
 * = demo id, no sub-path, no graph id).
 *
 * `graph` and `path` are MUTUALLY EXCLUSIVE — they are two different
 * ways of naming the same thing (a graph id addresses a LangGraph
 * server; a sub-path is appended to an HTTP agent URL), so declaring
 * both is always a manifest bug rather than a merge of the two.
 * parseManifest rejects the combination, naming slug + demo id.
 *
 * `graph` is additionally only legal when the manifest declares
 * `agent_kind: langgraph`, and — mirroring that — `path` is only legal when
 * `agent_kind` is `http`, either declared or taken as the implicit default. A
 * sub-path is appended to the agent BASE URL, so it means nothing under
 * `langgraph` (addressed by graph id) or `in-process` (no URL is dialled).
 *
 * ABSENT-PATH RULE (load-bearing — most demos rely on it):
 * when a demo has no `agent.path`, the resolver dials the integration's
 * base URL with a single trailing slash appended (`${BASE}/`). Every
 * integration surveyed dials its default agent that way today —
 * strands, pydantic-ai, ag2, ms-agent-harness-dotnet, spring-ai,
 * crewai-crews and langroid all use `${AGENT_URL}/`. This is NOT
 * cosmetic: FastAPI, Spring and ASP.NET mounts answer the slashless
 * form with a 307, and a 307 drops the POST body, so the demo hangs
 * instead of failing loudly. Encoding the rule once is what lets ~60
 * demos omit `agent` entirely rather than each carrying `path: "/"`.
 *
 * When a path IS given it is concatenated verbatim — no normalising,
 * no de-duplicating slashes. A bare "/" is legal and is simply the
 * explicit spelling of the default.
 *
 * `config` holds free-form AGENT-CONSTRUCTION options for this demo
 * (e.g. `{ recursion_limit: 25 }`) and is the per-demo override of the
 * integration-wide `agent_defaults`. It is deliberately unvalidated for
 * the same reason `agent_defaults` is: the accepted keys differ per
 * framework. It is NOT `demos[].runtime` — that block is strictly
 * CopilotRuntime options, and an agent-construction option placed there
 * is handed to `new CopilotRuntime()` and silently dropped. `config` is
 * legal with or without `graph`; it is not langgraph-only.
 */
export interface ManifestDemoAgent {
  readonly graph?: string;
  readonly path?: string;
  readonly name?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * Per-(integration, demo) CopilotRuntime option overrides
 * (`demos[].runtime`), keyed by CopilotRuntime option name — e.g.
 * `{ openGenerativeUI: true }`, `{ a2ui: { injectA2UITool: false } }`,
 * `{ mcpApps: { servers: [...] } }`.
 *
 * Values are passed through to CopilotRuntime UNTOUCHED and are
 * deliberately NOT validated. Same reasoning as `agent_defaults`: the
 * accepted options differ per framework and mirroring the runtime's
 * option surface here would rot on every runtime change.
 *
 * STRICTLY CopilotRuntime options — no key here is intercepted. An
 * AGENT-construction option (e.g. LangGraph's `recursion_limit`) put in
 * this block reaches `new CopilotRuntime()` and is silently dropped;
 * those belong under `demos[].agent.config` / `agent_defaults`.
 *
 * The value type is `unknown` rather than a nested record because an
 * option is NOT always an object: `openGenerativeUI` is the boolean
 * `true` in strands-typescript / claude-sdk-typescript / agno, but
 * `{ agents: [...] }` in ag2. The same option name legitimately takes
 * different value types across integrations, so no per-option
 * constraint is possible even in principle.
 */
export type RuntimeOverrides = Readonly<Record<string, unknown>>;

/**
 * One entry under `manifest.yaml :: demos[]`. Name is optional; id is
 * required AND non-empty (checked at runtime by parseManifest, typed
 * via the `DemoId` brand).
 *
 * Fields are `readonly`: parseManifest freezes the returned object so
 * downstream consumers cannot mutate a demo after validation. The type
 * matches the runtime freeze.
 */
export interface ManifestDemo {
  readonly id: DemoId;
  readonly name?: string;
  /**
   * Informational demos (e.g. cli-start): when set, the row surfaces this
   * copy-pasteable command in the dashboard instead of a live preview.
   * Such demos have no on-disk folder — parity / bundling skip them.
   */
  readonly command?: string;
  /**
   * Relative URL path for the demo. `id` is the CATALOG identifier
   * (stable; matched against spec/qa filenames and shell-side registry
   * entries), whereas `route` is the deliberate URL / filesystem path
   * (`/demos/<dir>` — resolved to `src/app/demos/<dir>/` by consumers
   * that need the on-disk location, e.g. bundle-demo-content and
   * validate-parity). The two are intentionally separate so renaming a
   * catalog id does not mass-rewrite URLs (and vice versa).
   *
   * Optional at the type boundary for backward compatibility with test
   * fixtures and historical manifests. When present, parseManifest
   * validates it is a non-empty string starting with "/demos/".
   * Consumers that need an on-disk demo directory should prefer
   * `route` when present and fall back to `id`.
   */
  readonly route?: string;
  /**
   * Optional agent mapping for this demo. See `ManifestDemoAgent`.
   * Absent when the manifest omits the block — parseManifest does NOT
   * synthesize a default object, so `demo.agent === undefined` means
   * "use the default mapping" and consumers keep one code path for
   * old and new manifests.
   */
  readonly agent?: ManifestDemoAgent;
  /**
   * Optional per-demo CopilotRuntime overrides. See `RuntimeOverrides`.
   */
  readonly runtime?: RuntimeOverrides;
}

/**
 * Union of the fields used by audit.ts / validate-parity.ts / capture-previews.ts.
 *
 * `slug` is REQUIRED: every manifest in showcase/integrations/ carries a
 * slug, and none of the three consumers ever constructs or accepts a
 * Manifest without one. Marking it required here lets downstream code
 * drop `manifest.slug ?? "(unknown)"` fallbacks without TypeScript
 * complaining. parseManifest enforces `slug` is a non-empty string at
 * runtime, so the type matches reality.
 *
 * `name` and `deployed` remain optional: in practice not every manifest
 * sets `name`, and `deployed` only appears when meaningful.
 *
 * `demos` is NON-optional but always set by parseManifest — an empty
 * readonly array when the manifest omits the field. Callers iterate
 * unconditionally instead of `?.` chaining.
 *
 * Fields are `readonly`: parseManifest deep-freezes the returned object
 * (including the nested `demos` array), so the public type matches the
 * runtime invariant. "Deep" is literal — the free-form blocks
 * (`agent_defaults`, `demos[].agent.config`, `demos[].runtime`) are frozen all
 * the way down by `deepFreeze`. They used to get one shallow
 * `Object.freeze({ ...block })`, which left every value below the first level
 * mutable while this sentence claimed otherwise.
 */
export interface Manifest {
  readonly slug: string;
  readonly name?: string;
  readonly deployed?: boolean;
  /**
   * Deployed backend URL for this integration (e.g. the Railway public
   * domain). Used by capture-previews.ts to navigate to each demo. Not
   * required by audit.ts / validate-parity.ts, so it remains optional;
   * callers that need it should check before use.
   * parseManifest validates that, when present, it is a non-empty string.
   */
  readonly backend_url?: string;
  /**
   * How this integration's agent is reached. Optional in the manifest;
   * left `undefined` here when omitted rather than defaulted to "http",
   * so consumers can tell "declared http" from "did not say" and the
   * parsed value round-trips back to the YAML. Consumers that need a
   * concrete kind should read `manifest.agent_kind ?? "http"`.
   */
  readonly agent_kind?: AgentKind;
  /**
   * WHICH frontend serves this integration's demos. See `DemoFrontend`.
   *
   * Left `undefined` when the manifest omits the key, so the parsed value
   * round-trips back to the YAML — same policy as `agent_kind`. Consumers must
   * NOT hand-write a fallback: read it through
   * `demoFrontendOf(manifest)`, which applies `DEFAULT_DEMO_FRONTEND` once so
   * every consumer resolves an omitted key the same way.
   */
  readonly demo_frontend?: DemoFrontend;
  /**
   * DEPRECATED — DEAD FIELD. Name of the env var holding the agent base
   * URL, as the standalone integration package historically read it.
   *
   * The unified app does NOT consume it: `agent-resolution.ts` resolves
   * `AGENT_URL_<SLUG>` (slug upper-snake-cased) and ONLY that, and its
   * `AgentIntegrationManifest.agent_url_env` is annotated "NOT CONSUMED"
   * for exactly this reason. Setting it therefore redirects nothing — a
   * reader who follows the field name is silently ignored. Kept parsed
   * (and validated) so the three manifests that still declare it keep
   * validating, and so the historical name stays recorded. Do NOT add it
   * to new manifests; see `backend_url` for the same deprecation shape.
   */
  readonly agent_url_env?: string;
  /**
   * Free-form per-integration agent-CONSTRUCTION defaults (e.g.
   * `{ recursion_limit: 100 }`). Intentionally untyped beyond "plain
   * object": accepted keys differ per framework, so enumerating them
   * here would rot. Overridden per demo by `demos[].agent.config`.
   */
  readonly agent_defaults?: Readonly<Record<string, unknown>>;
  /**
   * Feature ids this integration supports. `undefined` means the manifest
   * did not declare the key at all (test fixtures and pre-schema
   * manifests); every real manifest declares it — the JSON schema makes it
   * required with `minItems: 1`.
   *
   * Load-bearing for the frontend: `resolveDemoSupport` returns
   * `supported` for a demo id ONLY if it appears here, so a demo id
   * missing from this list renders the "not available" cell no matter how
   * completely `demos[]` wires it. The converse is worse: `resolveDemoSupport`
   * returns `supported` from this list ALONE, so an id here with no `demos[]`
   * row renders as a LIVE cell whose API call then 404s on manifest drift.
   * That is why parseManifest enforces BOTH directions below —
   * `demos[].id ⊆ features ∪ not_supported_features` AND
   * `features ⊆ demos[].id`.
   */
  readonly features?: readonly string[];
  /**
   * Feature ids this integration's framework cannot support. Excluded
   * from parity computation, and an explicit opt-out that WINS over
   * `features` in the frontend's support resolution.
   */
  readonly not_supported_features?: readonly string[];
  /**
   * Demo ids whose AGENT CANNOT EMIT AG-UI `REASONING_*` EVENTS, so the
   * unified runtime synthesises them (and strips `reasoning`-role messages out
   * of the replayed history, because the events make the client hold one and
   * the .NET AG-UI host's input mapper rejects that role).
   *
   * NOT CONSUMED BY THIS PACKAGE. It is parsed here for one reason: to gate
   * `synthetic_reasoning_demos ⊆ demos[].id` in CI. An id with no `demos[]`
   * row is a line that does nothing — the shim never fires, the reasoning cell
   * renders without a reasoning bubble, and nothing anywhere says why. The
   * consumer is `needsSyntheticReasoning` in
   * showcase/frontends/nextjs/src/lib/agent-resolution.ts.
   *
   * Per-DEMO, not per-integration, even though the incapacity is a property of
   * the whole .NET AG-UI host: the source routes shimmed exactly their three
   * reasoning cells, because injecting reasoning frames into
   * `tool-rendering-default-catchall` breaks that cell's spec.
   */
  readonly synthetic_reasoning_demos?: readonly string[];
  readonly demos: readonly ManifestDemo[];
}

/**
 * Tagged union of manifest parse outcomes. Callers discriminate on
 * `kind`:
 *
 *   - "missing"    — manifest.yaml does not exist on disk
 *   - "malformed"  — file exists but its contents do not round-trip
 *                    to a valid Manifest. Further split on `subkind`:
 *                    "syntax" = YAML parser rejected the text outright
 *                               (unterminated arrays, bad indentation);
 *                    "shape"  = YAML parsed but the resulting value
 *                               does not match the Manifest shape
 *                               (null/scalar top-level, non-array demos,
 *                               demo missing id, duplicate demo id, etc.)
 *   - "unreadable" — file exists but readFileSync threw
 *                    (permissions, I/O race, etc.)
 *   - "ok"         — parse succeeded and shape validated
 *
 * The `subkind` discriminator on "malformed" lets callers route each
 * failure mode distinctly: a "syntax" subkind flags a likely typo in
 * the YAML source, whereas "shape" flags a schema-drift / validation
 * problem (missing required field, wrong type, duplicate id, etc.).
 */
export type ParsedManifest =
  | { kind: "ok"; manifest: Manifest }
  | { kind: "missing" }
  | { kind: "malformed"; subkind: "syntax" | "shape"; error: string }
  | { kind: "unreadable"; error: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Describe a value for error messages. Distinguishes null/array from
 * plain `typeof` because `typeof null === "object"` and
 * `typeof [] === "object"` both hide the real shape from users.
 */
function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * True only for a plain object mapping — the shape YAML produces for a
 * nested block. Rejects null and arrays, both of which `typeof` reports
 * as "object" and both of which would silently pass a bare typeof
 * check while breaking every downstream key read.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * `Object.hasOwn`-backed predicate that narrows `obj` to a type where
 * `key` is known to exist. `Object.hasOwn` avoids inherited-property
 * pitfalls of the raw `in` operator for any plain object, and pairs
 * with the TS predicate so callers read `obj[key]` without further
 * casts.
 */
function hasOwnProp<K extends string>(
  obj: object,
  key: K,
): obj is object & Record<K, unknown> {
  return Object.hasOwn(obj, key);
}

/**
 * Shared frozen empty-array sentinel reused across the "no demos
 * declared" path. Every ok-result's `.demos` is this same frozen
 * readonly value when the manifest omits demos, so callers can iterate
 * unconditionally and the public `readonly` type matches the runtime
 * freeze.
 */
const EMPTY_DEMOS: readonly ManifestDemo[] = Object.freeze([]);

/**
 * Freeze a value and everything under it.
 *
 * `Object.freeze` is SHALLOW. The three free-form blocks this parser returns
 * — `agent_defaults`, `demos[].agent.config` and `demos[].runtime` — are
 * nested by nature (`{ mcpApps: { servers: [ … ] } }`), so a single
 * `Object.freeze({ ...block })` froze the top level and left every value
 * under it mutable. This function is what makes the "deep-freezes the
 * returned object" claim on `Manifest` / `parseManifest` true rather than
 * aspirational: one consumer mutating a nested option in place would
 * otherwise change what a second consumer, holding the same parsed manifest,
 * reads. `demo-runtime-options.ts` in the frontend carries its own
 * `deepFreeze` for exactly this hazard.
 *
 * Values come straight out of `yaml.parse`, so the graph is plain data
 * (objects, arrays, scalars) and freezing it is safe. A YAML alias can make
 * that graph cyclic; `Object.isFrozen` is the recursion guard, because a
 * frozen node is one we have already walked.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

/**
 * Outcome of validating one optional field. Kept as a union rather than
 * throwing so the caller keeps returning its usual
 * `{kind:"malformed", subkind:"shape"}` result without an exception
 * boundary in the middle of validation.
 */
type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The `route` pattern from `demos.items.properties.route` in
 * showcase/shared/manifest.schema.json, verbatim. Kept as a named constant so
 * the two spellings of one rule are visibly the same rule; the error message
 * prints it. `.` matches no line terminator in either dialect, which is the
 * whole point — see the check that uses it.
 */
const SCHEMA_ROUTE_RE = /^\/demos\/./;

/**
 * Validate an optional feature-id list (`features` /
 * `not_supported_features` / `synthetic_reasoning_demos`).
 *
 * `synthetic_reasoning_demos` shares this validator because it is the same
 * shape read the same way — a list of demo ids tested with `.includes(demoId)`,
 * so the substring hazard below is identical, and its consequence is worse: a
 * scalar there would silently switch the reasoning shim ON for every demo id
 * that is a substring of the text, including cells whose spec the extra events
 * break (`tool-rendering-default-catchall`).
 *
 * Both keys are `string[]` in the schema and both are read with
 * `.includes(demoId)` by the frontend. A YAML author who writes
 * `features: agentic-chat` (a scalar, not a list) produces a STRING there,
 * and `String.prototype.includes` is SUBSTRING matching — so
 * `features: agentic-chat-and-more` would report `agentic` and `chat` as
 * supported demos. Rejecting the non-array shape here is what keeps that
 * silent-and-wrong case from ever reaching a consumer.
 *
 * NULL POLICY: an ABSENT key means "did not say" and yields `undefined`,
 * which keeps the value round-trippable and lets the three cross-field checks
 * near the end of `parseManifest` opt out for fixtures that omit the field.
 * An EXPLICIT null (`features: ~`, or a `features:` line with nothing after
 * it) is REJECTED. This matches the manifest-wide policy the parser applies
 * everywhere except top-level `demos` — see the "rejects an explicit null for
 * every field except top-level demos" test — and it is the safe direction
 * here for a specific reason: all three cross-field checks are gated on
 * `features !== undefined`, so treating `features: ~` as "not declared"
 * silently switched OFF the features→demos check, the demos→features check
 * and the route/command reachability check at once. A null there is far more
 * likely a YAML slip than an author intending to opt out of three guards, and
 * nothing else would have caught it: `showcase/shared/manifest.schema.json`
 * marks `features` required, but ONLY generate-registry.ts runs that schema,
 * so validate-parity.ts would have passed a manifest the registry build then
 * rejects. Authors who really mean "no supported features" write `features:
 * []`, which is explicit and still runs every check.
 */
function parseFeatureIdList(
  obj: object,
  key: "features" | "not_supported_features" | "synthetic_reasoning_demos",
): FieldResult<readonly string[] | undefined> {
  if (!hasOwnProp(obj, key) || obj[key] === undefined) {
    return { ok: true, value: undefined };
  }
  const raw: unknown = obj[key];
  if (raw === null) {
    return {
      ok: false,
      error:
        `expected "${key}" to be an array of strings, got an explicit null. ` +
        `An absent key means "did not say"; a null is a YAML slip. Write ` +
        `"${key}: []" if you really mean the empty list — a null would ` +
        `silently disable the cross-field checks that gate demo/feature drift.`,
    };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: `expected "${key}" to be an array of strings, got ${describeType(raw)}`,
    };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];
    if (typeof item !== "string" || item.length === 0) {
      return {
        ok: false,
        error: `expected "${key}[${i}]" to be a non-empty string, got ${describeType(item)}`,
      };
    }
    // A repeated id is always a copy-paste slip: the list is read as a
    // membership set, so the duplicate changes nothing and hides the
    // author's intent (usually a second id they meant to type).
    if (seen.has(item)) {
      return {
        ok: false,
        error: `duplicate id "${item}" at "${key}[${i}]"`,
      };
    }
    seen.add(item);
    ids.push(item);
  }
  return { ok: true, value: Object.freeze(ids) };
}

/**
 * Read + parse + validate a manifest.yaml at `filePath`. Returns a
 * tagged-union `ParsedManifest`; never throws for content errors.
 *
 * The shape checks are intentionally strict:
 *   - top-level must be a plain object mapping (not null, scalar, or
 *     array) — otherwise downstream `.demos` / `.deployed` reads would
 *     TypeError at runtime;
 *   - `slug` must be a non-empty string (every consumer relies
 *     on it — missing slug is always a bug);
 *   - `name`, if present, must be a string;
 *   - `demos`, if present, must be an array of objects each with a
 *     string `id`, and each row must declare `route` or `command` (a row with
 *     neither has no page, no folder and nothing to display — see the check
 *     near the end of this function; gated on a declared `features` key);
 *   - `demos[].route`, if present, must match the schema's own
 *     `^/demos/.` pattern, so the two validators agree in BOTH directions;
 *   - `features` / `not_supported_features`, if present, must be arrays of
 *     unique non-empty strings — an explicit null is REJECTED like every
 *     other non-`demos` field, because "absent" is what switches the three
 *     cross-field checks off and a null must not do that silently (a scalar
 *     there separately turns the frontend's `.includes(demoId)` into
 *     substring matching — see `parseFeatureIdList` for both), every
 *     `demos[].id` must appear in one of the two
 *     lists, AND every `features` id must have a `demos[]` row (both
 *     directions — the second is the one that renders a live cell whose API
 *     404s, see the checks near the end of this function);
 *   - `deployed`, if present, must be a boolean (YAML `"yes"` parses to
 *     a string, which would be silently treated as truthy without this
 *     check — classic footgun).
 *
 * The agent-mapping fields (`agent_kind`, `agent_url_env`,
 * `agent_defaults`, `demos[].agent`, `demos[].runtime`) are ALL
 * optional: a manifest that predates them parses exactly as before, and
 * every field it omits stays `undefined` on the result. Three cross-field
 * rules are enforced, and their errors name the slug and the demo id so
 * the offending entry is locatable across the whole integration set:
 *   - `demos[].agent.graph` and `demos[].agent.path` are mutually
 *     exclusive;
 *   - `demos[].agent.graph` requires `agent_kind: langgraph`;
 *   - `demos[].agent.path` requires `agent_kind: http` (declared or the
 *     implicit default) — the mirror of the rule above. A path under
 *     `langgraph` / `in-process` is inert, and used to pass both validators
 *     and fail only at request time.
 *
 * Any shape failure produces
 * `{ kind: "malformed", subkind: "shape", error }` with a
 * human-readable reason. YAML parser failures produce
 * `{ kind: "malformed", subkind: "syntax", error }` (distinct so CI can
 * route syntax errors differently from schema-drift errors). Missing
 * files produce `{ kind: "missing" }` (distinct from malformed so
 * callers can emit different anomalies). Read errors (EACCES etc.)
 * produce `{ kind: "unreadable" }` — we do NOT collapse them into
 * malformed because the file's contents are not actually known to be
 * invalid.
 */
export function parseManifest(
  filePath: string,
  dirSlug?: string,
): ParsedManifest {
  // Empty-string dirSlug is a caller bug: `undefined` is the opt-out
  // sentinel ("caller did not supply a dir slug"). If a caller's
  // path.basename or similar produced `""` (trailing-slash path,
  // typo), silently collapsing to undefined would hide the bug and
  // skip the slug-mismatch guard. Surface as malformed-shape so the
  // caller sees the error at the parser boundary.
  if (dirSlug === "") {
    return {
      kind: "malformed",
      subkind: "shape",
      error: `caller passed empty dirSlug (use undefined to opt out of the slug-check)`,
    };
  }

  // Use statSync instead of fs.existsSync so ENOENT and non-ENOENT
  // errno values (EACCES, ENOTDIR, etc.) are distinguished. existsSync
  // CONFLATES these: a manifest whose parent dir is 0700 owned by
  // another user returns false from existsSync, which would collapse
  // an infrastructure failure into a benign "missing" signal. The
  // long docstring on probeDir in validate-parity.ts explains the
  // same anti-pattern — the fix is to stat + inspect errno.
  try {
    fs.statSync(filePath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { kind: "missing" };
    return { kind: "unreadable", error: errMsg(e) };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    return { kind: "unreadable", error: errMsg(e) };
  }

  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch (e) {
    return { kind: "malformed", subkind: "syntax", error: errMsg(e) };
  }

  // Top-level type guard. yaml.parse("") is null and yaml.parse("42") is
  // 42 — neither is a manifest. Arrays also aren't valid (manifest.yaml
  // is a mapping).
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "malformed",
      subkind: "shape",
      error: `expected YAML object at top level, got ${
        parsed === null ? "null (empty file?)" : describeType(parsed)
      }`,
    };
  }

  // At this point `parsed` is known to be a plain object mapping. We
  // narrow each field access through `hasOwnProp` so the compiler does
  // not need a blanket `as Record<string, unknown>` cast — every read
  // below is narrowed by the predicate it just passed.
  const obj: object = parsed;

  // slug is required — every consumer (audit.ts / validate-parity.ts /
  // capture-previews.ts) assumes a slug exists. A manifest without one is
  // always a bug, not a tolerable edge case.
  if (!hasOwnProp(obj, "slug")) {
    return {
      kind: "malformed",
      subkind: "shape",
      error: `missing required "slug" (non-empty string)`,
    };
  }
  const slug = obj.slug;
  if (typeof slug !== "string" || slug.length === 0) {
    // `hasOwnProp(obj, "slug")` already passed above, so the key is
    // present; the value can still be the empty string, null, or a
    // non-string. `describeType` covers all of those uniformly.
    return {
      kind: "malformed",
      subkind: "shape",
      error: `expected "slug" to be a non-empty string, got ${describeType(slug)}`,
    };
  }

  // Slug-mismatch guard. Every consumer derives the target
  // package by computing `packagesDir/<slug>/manifest.yaml`, so if the
  // manifest's declared slug disagrees with the directory that holds
  // it, downstream tools would silently key a copy-paste or rename
  // mistake into the wrong package. Catch at the parser so both tools
  // report the drift the same way.
  //
  // Opt-in: callers pass the expected dir slug via the `dirSlug`
  // parameter. When omitted (undefined), the check is skipped so
  // existing tests and programmatic callers that don't operate against
  // the packages tree continue to work. An explicit empty string is
  // rejected at the top of the function as a caller bug — `undefined`
  // is the opt-out sentinel; `""` is never a valid dir slug.
  // The two production callers (audit.ts, validate-parity.ts) pass the
  // slug they used to build the filePath.
  const expectedDirSlug = typeof dirSlug === "string" ? dirSlug : undefined;
  if (expectedDirSlug !== undefined && expectedDirSlug !== slug) {
    return {
      kind: "malformed",
      subkind: "shape",
      error: `slug mismatch: manifest declares "${slug}" but lives under dir "${expectedDirSlug}"`,
    };
  }

  // name (optional) must be a string if present.
  let name: string | undefined;
  if (hasOwnProp(obj, "name") && obj.name !== undefined) {
    if (typeof obj.name !== "string") {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "name" to be a string, got ${describeType(obj.name)}`,
      };
    }
    name = obj.name;
  }

  // deployed (optional) must be a real boolean if present.
  let deployed: boolean | undefined;
  if (hasOwnProp(obj, "deployed")) {
    if (typeof obj.deployed !== "boolean") {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "deployed" to be boolean, got ${describeType(obj.deployed)}`,
      };
    }
    deployed = obj.deployed;
  }

  // backend_url (optional) must be a non-empty string if present. Not
  // required by the audit/parity tools, so an absent field is fine.
  let backendUrl: string | undefined;
  if (hasOwnProp(obj, "backend_url") && obj.backend_url !== undefined) {
    if (typeof obj.backend_url !== "string" || obj.backend_url.length === 0) {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "backend_url" to be a non-empty string, got ${describeType(obj.backend_url)}`,
      };
    }
    backendUrl = obj.backend_url;
  }

  // agent_kind (optional) must be one of the known kinds if present.
  // Left undefined when absent — see the field docstring on Manifest for
  // why we do NOT default it to "http" here.
  let agentKind: AgentKind | undefined;
  if (hasOwnProp(obj, "agent_kind") && obj.agent_kind !== undefined) {
    const candidate = obj.agent_kind;
    if (
      typeof candidate !== "string" ||
      !AGENT_KINDS.includes(candidate as AgentKind)
    ) {
      return {
        kind: "malformed",
        subkind: "shape",
        error:
          `expected "agent_kind" to be one of ${AGENT_KINDS.join(" | ")}, got ` +
          (typeof candidate === "string"
            ? `"${candidate}"`
            : describeType(candidate)),
      };
    }
    agentKind = candidate as AgentKind;
  }

  // demo_frontend (optional) must be one of the known frontends if present.
  // Left undefined when absent; `demoFrontendOf` applies the default so the
  // "did not say" state never reaches a consumer as a third value.
  let demoFrontend: DemoFrontend | undefined;
  if (hasOwnProp(obj, "demo_frontend") && obj.demo_frontend !== undefined) {
    const candidate = obj.demo_frontend;
    if (
      typeof candidate !== "string" ||
      !DEMO_FRONTENDS.includes(candidate as DemoFrontend)
    ) {
      return {
        kind: "malformed",
        subkind: "shape",
        error:
          `expected "demo_frontend" to be one of ${DEMO_FRONTENDS.join(" | ")}, got ` +
          (typeof candidate === "string"
            ? `"${candidate}"`
            : describeType(candidate)),
      };
    }
    demoFrontend = candidate as DemoFrontend;
  }

  // agent_url_env (optional) must be a non-empty string if present. An
  // empty name would make consumers read `process.env[""]`, which is
  // always undefined — a silent "no agent URL" rather than an error.
  let agentUrlEnv: string | undefined;
  if (hasOwnProp(obj, "agent_url_env") && obj.agent_url_env !== undefined) {
    if (
      typeof obj.agent_url_env !== "string" ||
      obj.agent_url_env.length === 0
    ) {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "agent_url_env" to be a non-empty string, got ${describeType(obj.agent_url_env)}`,
      };
    }
    agentUrlEnv = obj.agent_url_env;
  }

  // agent_defaults (optional) is free-form, but must be a mapping. A
  // scalar or list here means the author mis-indented the block.
  let agentDefaults: Readonly<Record<string, unknown>> | undefined;
  if (hasOwnProp(obj, "agent_defaults") && obj.agent_defaults !== undefined) {
    if (!isPlainObject(obj.agent_defaults)) {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "agent_defaults" to be an object, got ${describeType(obj.agent_defaults)}`,
      };
    }
    // deepFreeze, not Object.freeze: the block is free-form and nested by
    // nature, and a shallow freeze left every value under the first level
    // mutable while the docstrings promised otherwise.
    agentDefaults = deepFreeze({ ...obj.agent_defaults });
  }

  // features / not_supported_features (both optional) must be arrays of
  // non-empty strings when declared. See parseFeatureIdList for why the
  // array check specifically is load-bearing.
  const featuresResult = parseFeatureIdList(obj, "features");
  if (!featuresResult.ok) {
    return {
      kind: "malformed",
      subkind: "shape",
      error: featuresResult.error,
    };
  }
  const features = featuresResult.value;

  const notSupportedResult = parseFeatureIdList(obj, "not_supported_features");
  if (!notSupportedResult.ok) {
    return {
      kind: "malformed",
      subkind: "shape",
      error: notSupportedResult.error,
    };
  }
  const notSupportedFeatures = notSupportedResult.value;

  // Same shape, same validator. The cross-field check that gives this field its
  // point (`⊆ demos[].id`) runs after `demos` is validated, further down.
  const syntheticReasoningResult = parseFeatureIdList(
    obj,
    "synthetic_reasoning_demos",
  );
  if (!syntheticReasoningResult.ok) {
    return {
      kind: "malformed",
      subkind: "shape",
      error: syntheticReasoningResult.error,
    };
  }
  const syntheticReasoningDemos = syntheticReasoningResult.value;

  // demos must be an array of objects with non-empty string id. Both
  // "key absent" and "explicit null" (YAML `demos:`) are treated as
  // "no demos declared" — parseManifest normalizes to an empty frozen
  // array so `Manifest.demos` is always set. If the key is present with
  // a non-nullish value that is not an array, fall through and report.
  let demos: readonly ManifestDemo[] = EMPTY_DEMOS;
  if (hasOwnProp(obj, "demos") && obj.demos != null) {
    const rawDemos = obj.demos;
    if (!Array.isArray(rawDemos)) {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "demos" to be an array, got ${describeType(rawDemos)}`,
      };
    }
    const validated: ManifestDemo[] = [];
    // Duplicate-id detection: two demos with the same id cascade into
    // double-counted coverage and double missing-demo-dir anomalies
    // downstream. Reject at validation time so the error surfaces at
    // the manifest, not at the consuming tool.
    const seen = new Set<string>();
    for (let i = 0; i < rawDemos.length; i++) {
      const d: unknown = rawDemos[i];
      if (d === null || typeof d !== "object" || Array.isArray(d)) {
        return {
          kind: "malformed",
          subkind: "shape",
          error: `expected demos[${i}] to be an object, got ${describeType(d)}`,
        };
      }
      if (!hasOwnProp(d, "id") || typeof d.id !== "string") {
        // Missing key or non-string value: describe the actual type so
        // debuggers can distinguish this from the empty-string branch
        // below. `describeType(undefined)` covers the missing-key case
        // (the `hasOwnProp` narrowing means `d.id` is typed as unknown
        // only inside the branch, but at runtime an absent key reads as
        // undefined).
        const actual = hasOwnProp(d, "id") ? d.id : undefined;
        return {
          kind: "malformed",
          subkind: "shape",
          error: `expected demos[${i}].id to be a string, got ${describeType(actual)}`,
        };
      }
      const brandedId = createDemoId(d.id);
      if (brandedId === null) {
        // `d.id` is a string here (checked above); createDemoId only
        // returns null for the empty-string case. Keep the "non-empty
        // string" wording so this branch is distinct from the
        // missing/non-string branch above.
        return {
          kind: "malformed",
          subkind: "shape",
          error: `expected demos[${i}].id to be a non-empty string`,
        };
      }
      if (seen.has(brandedId)) {
        return {
          kind: "malformed",
          subkind: "shape",
          error: `duplicate demo id "${brandedId}" at demos[${i}]`,
        };
      }
      seen.add(brandedId);
      // demo-level `name` strictness: match the strictness applied to
      // other fields so schema drift (present-but-wrong-type name)
      // surfaces at the parser, not downstream. Absent `name` remains
      // valid.
      let demoName: string | undefined;
      if (hasOwnProp(d, "name") && d.name !== undefined) {
        if (typeof d.name !== "string") {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `expected demos[${i}].name to be a string, got ${describeType(d.name)}`,
          };
        }
        demoName = d.name;
      }
      // demo-level `command`: optional informational demos (e.g. cli-start).
      // When set, the row surfaces this copy-pasteable command in the
      // dashboard instead of a live preview. Such demos have no on-disk
      // folder — parity / bundling skip them.
      let demoCommand: string | undefined;
      if (hasOwnProp(d, "command") && d.command !== undefined) {
        if (typeof d.command !== "string" || d.command.length === 0) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `expected demos[${i}].command to be a non-empty string, got ${describeType(d.command)}`,
          };
        }
        demoCommand = d.command;
      }
      // demo-level `route`: optional. When present, must be a non-empty
      // string beginning with "/demos/" so downstream consumers
      // (bundle-demo-content, validate-parity) can uniformly strip that
      // prefix to derive the on-disk demo directory. The `/demos/` guard
      // catches accidental absolute URLs or bare segments that would
      // silently point to the wrong directory at runtime.
      let demoRoute: string | undefined;
      if (hasOwnProp(d, "route") && d.route !== undefined) {
        if (typeof d.route !== "string" || d.route.length === 0) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `expected demos[${i}].route to be a non-empty string, got ${describeType(d.route)}`,
          };
        }
        if (!d.route.startsWith("/demos/")) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `expected demos[${i}].route to start with "/demos/", got "${d.route}"`,
          };
        }
        // Reject exactly "/demos/" (empty tail segment). Downstream
        // consumers strip the "/demos/" prefix to derive an on-disk
        // directory name; an empty tail would point at the parent
        // demos/ directory rather than a specific demo. Guard at the
        // parser boundary so validate-parity / bundle-demo-content can
        // treat a successful parse as a non-empty segment invariant.
        if (d.route.length <= "/demos/".length) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `expected demos[${i}].route to have a non-empty segment after "/demos/", got "${d.route}"`,
          };
        }
        // THE REVERSE HALF OF THE SCHEMA/PARSER AGREEMENT. The schema's
        // pattern is `^/demos/.` and JSON Schema's `.` never matches a line
        // terminator, so `route: "/demos/\n"` is REJECTED there — while the
        // two checks above accepted it, because it starts with the prefix and
        // is 8 characters long. That is the same class of split gate as
        // `route: /starter` in the other direction: one validator's verdict
        // depended on which validator ran. Applying the schema's own regex
        // makes the two agree exactly.
        if (!SCHEMA_ROUTE_RE.test(d.route)) {
          return {
            kind: "malformed",
            subkind: "shape",
            error:
              `expected demos[${i}].route to match ${String(SCHEMA_ROUTE_RE)} ` +
              `(the pattern in manifest.schema.json), got ${JSON.stringify(d.route)}. ` +
              `The segment after "/demos/" must not start with a line break.`,
          };
        }
        demoRoute = d.route;
      }
      // demo-level `agent`: optional mapping of this demo onto an agent.
      // Errors name BOTH the slug and the demo id (not just the numeric
      // index) because these are cross-field rules an author fixes by
      // looking at the whole integration, and 21 manifests are being
      // populated against this contract at once — "demos[3]" alone is
      // not enough to locate the bad entry.
      let demoAgent: ManifestDemoAgent | undefined;
      if (hasOwnProp(d, "agent") && d.agent !== undefined) {
        const rawAgent = d.agent;
        if (!isPlainObject(rawAgent)) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `expected demos[${i}].agent to be an object, got ${describeType(rawAgent)} (slug "${slug}", demo "${brandedId}")`,
          };
        }
        const agentFields: {
          graph?: string;
          path?: string;
          name?: string;
          config?: Readonly<Record<string, unknown>>;
        } = {};
        for (const key of ["graph", "path", "name"] as const) {
          if (!Object.hasOwn(rawAgent, key) || rawAgent[key] === undefined) {
            continue;
          }
          const value = rawAgent[key];
          if (typeof value !== "string" || value.length === 0) {
            return {
              kind: "malformed",
              subkind: "shape",
              error: `expected demos[${i}].agent.${key} to be a non-empty string, got ${describeType(value)} (slug "${slug}", demo "${brandedId}")`,
            };
          }
          agentFields[key] = value;
        }
        // `agent.config` is free-form (like `agent_defaults`), but must
        // be a mapping. A scalar or list here means the author
        // mis-indented the block, and the values would otherwise be
        // spread into the agent constructor as garbage.
        if (
          Object.hasOwn(rawAgent, "config") &&
          rawAgent.config !== undefined
        ) {
          if (!isPlainObject(rawAgent.config)) {
            return {
              kind: "malformed",
              subkind: "shape",
              error: `expected demos[${i}].agent.config to be an object, got ${describeType(rawAgent.config)} (slug "${slug}", demo "${brandedId}")`,
            };
          }
          agentFields.config = deepFreeze({ ...rawAgent.config });
        }
        // `path` is concatenated onto the agent base URL VERBATIM — no
        // normalising, no de-duplicating slashes. Without a leading
        // slash it would fuse onto the last URL segment
        // ("http://host" + "sub" -> "http://hostsub"), so require it at
        // the parser rather than debugging a mangled URL later.
        //
        // A bare "/" IS allowed: five integrations (ag2,
        // ms-agent-harness-dotnet, spring-ai, crewai-crews, langroid)
        // mount their shared agent at exactly `${AGENT_URL}/`, and an
        // earlier revision's "non-empty segment" guard rejected the
        // natural transcription of that. See the `path` description in
        // manifest.schema.json for the absent-path rule.
        if (
          agentFields.path !== undefined &&
          !agentFields.path.startsWith("/")
        ) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `expected demos[${i}].agent.path to start with "/", got "${agentFields.path}" (slug "${slug}", demo "${brandedId}")`,
          };
        }
        // Mutual exclusion: graph and path are two different addressing
        // schemes for the same agent, so both together is always a bug.
        // Silently preferring one would make the ignored field look
        // effective.
        if (agentFields.graph !== undefined && agentFields.path !== undefined) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `demos[${i}].agent declares both "graph" and "path" — they are mutually exclusive (slug "${slug}", demo "${brandedId}")`,
          };
        }
        // `graph` is a LangGraph graph id and is only meaningful when
        // the whole integration is addressed as a LangGraph server.
        // Note the omitted-agent_kind case falls here too: the implicit
        // default is "http".
        if (agentFields.graph !== undefined && agentKind !== "langgraph") {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `demos[${i}].agent.graph is only valid when agent_kind is "langgraph", but agent_kind is "${agentKind ?? "http (default)"}" (slug "${slug}", demo "${brandedId}")`,
          };
        }
        // MIRROR OF THE RULE ABOVE. `path` is a URL sub-path appended to the
        // integration's agent base URL, so it only means anything when that
        // base URL is dialled at all — i.e. `agent_kind: http`, whether
        // declared or taken as the implicit default.
        //
        // Under `langgraph` the demo is addressed by GRAPH ID, and under
        // `in-process` no URL is dialled at all (the agent runs inside the
        // Next.js app, resolved through IN_PROCESS_AGENT_FACTORIES by agent
        // NAME). In both cases a `path` is inert: it passes every validator and
        // then silently changes nothing, so the author's intended sub-path is
        // never reached and the failure looks like a backend problem.
        //
        // The `graph` half of this pair was checked three times over (here, the
        // mutual-exclusion rule above, and an `allOf` guard in
        // manifest.schema.json) while the `path` half was checked nowhere.
        if (
          agentFields.path !== undefined &&
          agentKind !== undefined &&
          agentKind !== "http"
        ) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `demos[${i}].agent.path is only valid when agent_kind is "http" (declared or default), but agent_kind is "${agentKind}" (slug "${slug}", demo "${brandedId}"). A sub-path is appended to the agent BASE URL; "langgraph" addresses demos by graph id and "in-process" dials no URL at all, so the path would be silently ignored.`,
          };
        }
        demoAgent = Object.freeze(agentFields);
      }
      // demo-level `runtime`: optional CopilotRuntime overrides, keyed
      // by CopilotRuntime option name. Only the TOP-LEVEL mapping shape
      // is checked; the option VALUES are passed through untouched and
      // deliberately unvalidated (see RuntimeOverrides). We do not
      // require each value to be an object — `openGenerativeUI: true`
      // is a real, required value, and the same option is an object in
      // other integrations, so there is no per-option shape to enforce.
      let demoRuntime: RuntimeOverrides | undefined;
      if (hasOwnProp(d, "runtime") && d.runtime !== undefined) {
        const rawRuntime = d.runtime;
        if (!isPlainObject(rawRuntime)) {
          return {
            kind: "malformed",
            subkind: "shape",
            error: `expected demos[${i}].runtime to be an object, got ${describeType(rawRuntime)} (slug "${slug}", demo "${brandedId}")`,
          };
        }
        // deepFreeze: a runtime block is `{ mcpApps: { servers: [ … ] } }`
        // shaped, so a shallow freeze protected only the option NAMES.
        demoRuntime = deepFreeze({ ...rawRuntime });
      }
      const demoEntry: {
        id: DemoId;
        name?: string;
        command?: string;
        route?: string;
        agent?: ManifestDemoAgent;
        runtime?: RuntimeOverrides;
      } = {
        id: brandedId,
      };
      if (demoName !== undefined) demoEntry.name = demoName;
      if (demoCommand !== undefined) demoEntry.command = demoCommand;
      if (demoRoute !== undefined) demoEntry.route = demoRoute;
      if (demoAgent !== undefined) demoEntry.agent = demoAgent;
      if (demoRuntime !== undefined) demoEntry.runtime = demoRuntime;
      validated.push(Object.freeze(demoEntry));
    }
    demos = Object.freeze(validated);
  }

  // CROSS-FIELD INVARIANT: every demo id must be DECLARED, either as a
  // supported feature or as an explicit non-supported one.
  //
  // The frontend's `resolveDemoSupport` returns "supported" only for ids
  // listed in `features`; an id that appears in `demos[]` alone falls
  // through to "not supported", so the cell renders unavailable and its
  // API 404s even though `demos[]` wires an agent path, a route and
  // highlight files. That is silent and wrong, and it happened for real
  // (google-adk :: tool-rendering-reasoning-chain). Nothing else checks
  // it, so it is checked here.
  //
  // Skipped when the manifest declares no `features` key at all: that is
  // the "did not say" case (test fixtures, pre-schema manifests), and the
  // JSON schema already makes `features` required for real manifests.
  if (features !== undefined) {
    const declared = new Set<string>([
      ...features,
      ...(notSupportedFeatures ?? []),
    ]);
    for (const demo of demos) {
      if (!declared.has(demo.id)) {
        return {
          kind: "malformed",
          subkind: "shape",
          error:
            `demo "${demo.id}" is declared under "demos" but appears in neither ` +
            `"features" nor "not_supported_features" (slug "${slug}"). The app ` +
            `resolves support from those two lists, so the demo would render as ` +
            `unavailable despite being wired — add it to "features" if it works, ` +
            `or to "not_supported_features" if it cannot.`,
        };
      }
    }

    // THE OTHER DIRECTION OF THE SAME INVARIANT: every id in `features` must
    // also have a `demos[]` row.
    //
    // This is the direction that actually breaks users, and until now it was
    // the only one NOT enforced. `resolveDemoSupport` returns "supported" from
    // `features` ALONE, so an id listed there with no `demos[]` row renders as a
    // LIVE cell — the dashboard advertises it, the page mounts — and then
    // `POST /api/<slug>/<demo>` 404s with a "manifest drift" body, because the
    // agent for a demo is resolved out of `demos[]` and there is no row to
    // resolve. Where a static demo page exists (shared-state-read did, in nine
    // integrations) the user gets a fully rendered chat UI that can never
    // answer. That state shipped for 20 (integration, demo) pairs at once, and
    // the forward check above could not see any of them: the data already
    // satisfied `demos[].id ⊆ features`, so it walked straight through.
    //
    // NO EXEMPTION IS NEEDED FOR INFORMATIONAL DEMOS. An informational demo
    // (e.g. `cli-start`) carries a `demos[]` row too — it just declares
    // `command` instead of `route` — so it is a member of `demoIds` like any
    // other. The absence of a row is always the drift this check is for.
    //
    // Like the forward check, this is skipped when `features` is absent (test
    // fixtures / pre-schema manifests); the JSON schema makes the key required
    // with `minItems: 1` for real manifests.
    const demoIds = new Set<string>(demos.map((d) => d.id));
    for (const featureId of features) {
      if (!demoIds.has(featureId)) {
        return {
          kind: "malformed",
          subkind: "shape",
          error:
            `feature "${featureId}" is listed under "features" but has no ` +
            `"demos" entry (slug "${slug}"). The app resolves a cell as LIVE ` +
            `from "features" alone, then resolves the agent from "demos" — so ` +
            `this cell renders as available and its POST /api/${slug}/${featureId} ` +
            `fails on manifest drift. Add the "demos" entry if the backend serves ` +
            `it, move the id to "not_supported_features" if the framework cannot, ` +
            `or drop the id if this integration simply does not ship it.`,
        };
      }
    }

    // EVERY ROW MUST BE REACHABLE: `route` (a live cell) or `command` (an
    // informational cell). A row carrying only { id, name, description, tags }
    // passed this parser, `assertManifest` in the frontend AND the JSON schema,
    // and then 404ed at request time: with no route there is no page to render
    // and no on-disk folder to bundle, with no command there is nothing to show
    // instead, and with no agent the app resolves it as `informational` while
    // `resolveDemoRequest` refuses it. `route`'s own docstring already named
    // `command` as the alternative; nothing required one of the pair.
    //
    // Gated on a declared `features` key for the same reason as the two checks
    // above: no key means "did not say" (test fixtures, pre-schema manifests),
    // and `showcase/shared/manifest.schema.json` carries the matching `anyOf`
    // for real manifests, where `features` is required.
    //
    // LAST of the cross-field checks on purpose: the two above diagnose WHICH
    // ids are wired, and their messages are more specific than this one, so a
    // manifest with both problems should hear about the drift first.
    for (const [index, demo] of demos.entries()) {
      if (demo.route !== undefined || demo.command !== undefined) continue;
      return {
        kind: "malformed",
        subkind: "shape",
        error:
          `demos[${index}] ("${demo.id}") declares neither "route" nor ` +
          `"command" (slug "${slug}"). A row with no route has no page and no ` +
          `on-disk folder, so it can only be an INFORMATIONAL cell — and that ` +
          `needs a "command" to display. Add "route: /demos/<dir>" if the demo ` +
          `has a page, or "command: <shell command>" if it is a copy-paste ` +
          `cell like cli-start.`,
      };
    }
  }

  // CROSS-FIELD INVARIANT: every id in `synthetic_reasoning_demos` must have a
  // `demos[]` row.
  //
  // The field names the demos whose backend cannot emit AG-UI `REASONING_*`
  // events, and the unified runtime matches it against the demo id it is
  // resolving. An id with no row can therefore never match: the reasoning shim
  // never fires, the cell renders with no reasoning bubble, and the only
  // symptom is a red D6 cell that looks like a model failure. A typo
  // (`reasoning-defualt`) is exactly that, and nothing else would catch it —
  // the JSON schema validates the shape, not the membership.
  //
  // NOT gated on `features` (unlike the three checks above): this field is
  // independent of the support lists, and a fixture that declares it without
  // declaring `features` still means what it says.
  if (syntheticReasoningDemos !== undefined) {
    const demoIds = new Set<string>(demos.map((demo) => demo.id));
    for (const demoId of syntheticReasoningDemos) {
      if (!demoIds.has(demoId)) {
        return {
          kind: "malformed",
          subkind: "shape",
          error:
            `demo "${demoId}" is listed under "synthetic_reasoning_demos" but ` +
            `has no "demos" entry (slug "${slug}"). The runtime applies the ` +
            `reasoning shim by matching the demo id it is serving, so this id ` +
            `matches nothing: the cell would render with no reasoning bubble ` +
            `and nothing would say why. Fix the id, add the "demos" entry, or ` +
            `drop the id.`,
        };
      }
    }
  }

  // Construct the result field-by-field from the narrowed locals so
  // there is no `as unknown as Manifest` double-cast crossing the
  // validation boundary. Each field below was checked individually
  // above; the compiler tracks the narrowed type through the local
  // bindings, so this object literal typechecks against Manifest
  // without any casts. The final object is frozen so the `readonly`
  // fields on Manifest match the runtime behavior.
  const manifest: Manifest = Object.freeze({
    slug,
    ...(name !== undefined ? { name } : {}),
    ...(deployed !== undefined ? { deployed } : {}),
    ...(backendUrl !== undefined ? { backend_url: backendUrl } : {}),
    ...(agentKind !== undefined ? { agent_kind: agentKind } : {}),
    ...(demoFrontend !== undefined ? { demo_frontend: demoFrontend } : {}),
    ...(agentUrlEnv !== undefined ? { agent_url_env: agentUrlEnv } : {}),
    ...(agentDefaults !== undefined ? { agent_defaults: agentDefaults } : {}),
    ...(features !== undefined ? { features } : {}),
    ...(notSupportedFeatures !== undefined
      ? { not_supported_features: notSupportedFeatures }
      : {}),
    ...(syntheticReasoningDemos !== undefined
      ? { synthetic_reasoning_demos: syntheticReasoningDemos }
      : {}),
    demos,
  });
  return { kind: "ok", manifest };
}

/**
 * The CONCRETE frontend that serves `manifest`'s demos, applying
 * `DEFAULT_DEMO_FRONTEND` when the key is omitted.
 *
 * Every consumer must go through this rather than writing
 * `manifest.demo_frontend ?? "integration"` inline. The default is the thing
 * most likely to be spelled differently in two places (one caller defaulting
 * to "unified" for a slug that has no key, another to "integration", and the
 * two disagreeing silently for exactly the un-migrated slugs), which is the
 * class of drift this whole field exists to remove.
 */
export function demoFrontendOf(manifest: Manifest): DemoFrontend {
  return manifest.demo_frontend ?? DEFAULT_DEMO_FRONTEND;
}

/**
 * The CONTAINER-network URL the compose roster (`LOCAL_SERVICES_JSON`) must use
 * as a slug's `publicUrl`, derived from its `demo_frontend`.
 *
 * This is the single definition of the compose-side value, shared by the
 * emitter (`emit-local-services-env.ts`) and its tests. It is a CONTAINER
 * URL, not a host one — the harness CLI's host-side equivalent lives in
 * `showcase/harness/src/cli/config.ts` (`getSlugOrigins`), and the two cannot
 * be one function because they name different networks. They ARE cross-checked
 * against each other; see `unified-frontend-sources.test.ts` in the harness.
 *
 * `frontend-nextjs` and port 3000 are the compose SERVICE name (and therefore
 * the network DNS alias) and container port declared for the unified app in
 * `showcase/docker-compose.local.yml` — published to the host as 3200:3000.
 * Only `container_name` is rewritten per isolated project, never the service
 * name, so this alias resolves inside an `--isolate` network too.
 *
 * The `/<slug>` path segment is REQUIRED and part of the base: consumers append
 * `/demos/<id>`, so dropping it makes every cell probe a 404 on the unified
 * app's root.
 */
export const UNIFIED_FRONTEND_COMPOSE_ORIGIN = "http://frontend-nextjs:3000";

export function composePublicUrlFor(
  slug: string,
  frontend: DemoFrontend,
): string {
  return frontend === "unified"
    ? `${UNIFIED_FRONTEND_COMPOSE_ORIGIN}/${slug}`
    : `http://${slug}:10000`;
}
