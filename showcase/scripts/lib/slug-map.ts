/**
 * Shared slug / examples-directory mapping tables.
 *
 * Three tools consume these:
 *   - audit.ts               (showcase slug → examples dir name[s])
 *   - validate-pins.ts       (showcase slug → examples dir, via SLUG_MAP
 *                              inverse + FALLBACK_MAP override)
 *   - validate-parity.ts     (born-in-showcase membership)
 *
 * Prior to extraction each script carried its own copy. Drift between
 * copies led to:
 *   - audit.ts listing phantom "no examples source" anomalies for
 *     slugs whose entries pointed at non-existent showcase packages
 *     (crewai-flows, agent-spec-langgraph, mcp-apps);
 *   - validate-pins.ts maintaining its own FALLBACK_MAP of stale
 *     SLUG_MAP entries;
 *   - three different BORN_IN_SHOWCASE sets that could silently
 *     disagree.
 *
 * Everything here is immutable. We freeze the plain-object maps and
 * wrap the Set/Map values in a Proxy (a frozen plain Object is not
 * enough for Map/Set — their `.set`/`.add` methods don't respect
 * Object.freeze). The consequence: any runtime mutation attempt
 * throws, matching the TypeScript `Readonly*` types.
 */

/**
 * Semantic alias: a slug that names a `showcase/packages/<slug>/`
 * directory. Structurally a plain string (so external callers can
 * compare against arbitrary strings without ceremony) but named
 * distinctly from `ExamplesDir` so the map signatures below document
 * their direction of mapping. The runtime invariant — every
 * ShowcaseSlug is an actual directory under `showcase/packages/` — is
 * enforced by slug-map.test.ts, not by the type system.
 */
export type ShowcaseSlug = string;

/**
 * Semantic alias: a directory name under `examples/integrations/` (or
 * `integrations/` in older trees). Intentionally distinct at the type
 * level from ShowcaseSlug so the SLUG_MAP / SLUG_TO_EXAMPLES /
 * FALLBACK_MAP signatures read unambiguously. Structurally `string`
 * for the same reason as ShowcaseSlug: external callers iterate these
 * maps with plain strings and we don't want to force `as` casts on
 * every caller.
 */
export type ExamplesDir = string;

/**
 * Wrap a Set so mutation methods throw. Object.freeze on a Set does
 * not prevent .add/.delete — the set itself is frozen but its internal
 * slots are not. Casting to ReadonlySet is compile-time only.
 *
 * The returned type is ReadonlySet<T> (not Set<T>): callers that keep
 * a Set handle would bypass the runtime guard, so we force the narrow
 * type out of the helper.
 */
function freezeSet<T>(s: Set<T>): ReadonlySet<T> {
  // Replace mutation methods FIRST, THEN freeze — Object.freeze locks
  // the object non-extensible, after which defineProperty throws.
  // `add` is typed to return the set so we match that signature but
  // throw before anything can observe the return value.
  const fail = (method: string) => () => {
    throw new TypeError(`Cannot ${method} frozen Set`);
  };
  Object.defineProperty(s, "add", { value: fail("add") });
  Object.defineProperty(s, "delete", { value: fail("delete") });
  Object.defineProperty(s, "clear", { value: fail("clear") });
  return Object.freeze(s);
}

function freezeMap<K, V>(m: Map<K, V>): ReadonlyMap<K, V> {
  const fail = (method: string) => () => {
    throw new TypeError(`Cannot ${method} frozen Map`);
  };
  Object.defineProperty(m, "set", { value: fail("set") });
  Object.defineProperty(m, "delete", { value: fail("delete") });
  Object.defineProperty(m, "clear", { value: fail("clear") });
  return Object.freeze(m);
}

/**
 * Freeze a 2D record (outer object + inner arrays) in one call. The
 * outer record is frozen so keys cannot be added/removed/reassigned;
 * each inner array is also frozen so element assignment (`arr[0] = …`)
 * throws in strict mode. Prevents the common "I froze the outer but
 * forgot the inner" bug and ensures the Readonly<...> type matches the
 * runtime behavior.
 */
function freezeMap2D<K extends string, V>(
  obj: Record<K, readonly V[]>,
): Readonly<Record<K, readonly V[]>> {
  for (const k of Object.keys(obj) as K[]) {
    Object.freeze(obj[k]);
  }
  return Object.freeze(obj);
}

/**
 * Packages intentionally without a Dojo (examples/integrations)
 * counterpart. They are the single source of truth for:
 *   - audit.ts  → skip the "missing examples/integrations counterpart"
 *                 anomaly;
 *   - validate-pins.ts → emit [SKIP] instead of [WARN].
 */
export const BORN_IN_SHOWCASE: ReadonlySet<ShowcaseSlug> = freezeSet(
  new Set<ShowcaseSlug>([
    "ag2",
    "claude-sdk-python",
    "claude-sdk-typescript",
    "langroid",
    "spring-ai",
  ]),
);

/**
 * Forward map: examples/integrations directory name → showcase slug.
 * Mirrors migrate-integration-examples.ts (which does not export its
 * SLUG_MAP). Kept as a Map for O(1) lookup and so `.get()` returns
 * `ShowcaseSlug | undefined` unambiguously.
 *
 * Only entries whose VALUES correspond to real `showcase/packages/<slug>/`
 * directories are included. Dead entries (crewai-flows → crewai,
 * pydantic-ai → pydanticai, ms-agent-framework-dotnet → maf-dotnet,
 * etc.) were removed because they broke validate-pins.ts's reverse
 * lookup and forced FALLBACK_MAP to re-express the corrections. The
 * slug-map.test.ts pins this invariant against the real packages/ tree
 * so future edits cannot reintroduce the drift.
 */
export const SLUG_MAP: ReadonlyMap<ExamplesDir, ShowcaseSlug> = freezeMap(
  new Map<ExamplesDir, ShowcaseSlug>([
    ["langgraph-python", "langgraph-python"],
    ["langgraph-js", "langgraph-typescript"],
    ["langgraph-fastapi", "langgraph-fastapi"],
    ["mastra", "mastra"],
    ["agno", "agno"],
    ["llamaindex", "llamaindex"],
    ["adk", "google-adk"],
  ]),
);

/**
 * Reverse / corrected map used by audit.ts: showcase slug → candidate
 * examples/integrations dir name(s). Dead entries that pointed at
 * non-existent showcase packages (crewai-flows, agent-spec-langgraph,
 * mcp-apps) are intentionally excluded so audit.ts no longer emits
 * phantom "no examples source" anomalies for them.
 *
 * freezeMap2D freezes BOTH the outer record (no adding/removing keys,
 * no reassigning arrays) AND each inner array (no element assignment).
 * The compile-time `Readonly<Record<..., readonly ExamplesDir[]>>`
 * matches.
 */
export const SLUG_TO_EXAMPLES: Readonly<
  Record<ShowcaseSlug, readonly ExamplesDir[]>
> = freezeMap2D<ShowcaseSlug, ExamplesDir>({
  "langgraph-python": ["langgraph-python"],
  "langgraph-typescript": ["langgraph-js"],
  "langgraph-fastapi": ["langgraph-fastapi"],
  mastra: ["mastra"],
  "crewai-crews": ["crewai-crews"],
  "pydantic-ai": ["pydantic-ai"],
  agno: ["agno"],
  llamaindex: ["llamaindex"],
  "google-adk": ["adk"],
  "ms-agent-dotnet": ["ms-agent-framework-dotnet"],
  "ms-agent-python": ["ms-agent-framework-python"],
  strands: ["strands-python"],
});

/**
 * Fallback map used by validate-pins.ts: showcase slug → examples dir
 * name. These entries document known SLUG_MAP staleness — the slug
 * under `showcase/packages/` no longer matches the value in SLUG_MAP,
 * so we override here. If SLUG_MAP is refreshed, clean up these
 * entries accordingly.
 */
export const FALLBACK_MAP: Readonly<Record<ShowcaseSlug, ExamplesDir>> =
  Object.freeze({
    "crewai-crews": "crewai-crews",
    "ms-agent-dotnet": "ms-agent-framework-dotnet",
    "ms-agent-python": "ms-agent-framework-python",
    "pydantic-ai": "pydantic-ai",
    strands: "strands-python",
  });
