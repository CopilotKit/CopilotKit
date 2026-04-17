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
 * Wrap a Set so mutation methods throw. Object.freeze on a Set does
 * not prevent .add/.delete — the set itself is frozen but its internal
 * slots are not. Casting to ReadonlySet is compile-time only.
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
 * Packages intentionally without a Dojo (examples/integrations)
 * counterpart. They are the single source of truth for:
 *   - audit.ts  → skip the "missing examples/integrations counterpart"
 *                 anomaly;
 *   - validate-pins.ts → emit [SKIP] instead of [WARN].
 */
export const BORN_IN_SHOWCASE: ReadonlySet<string> = freezeSet(
  new Set<string>([
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
 * `string | undefined` unambiguously.
 */
export const SLUG_MAP: ReadonlyMap<string, string> = freezeMap(
  new Map<string, string>([
    ["langgraph-python", "langgraph-python"],
    ["langgraph-js", "langgraph-typescript"],
    ["langgraph-fastapi", "langgraph-fastapi"],
    ["mastra", "mastra"],
    ["crewai-crews", "crewai"],
    ["crewai-flows", "crewai"],
    ["pydantic-ai", "pydanticai"],
    ["agno", "agno"],
    ["llamaindex", "llamaindex"],
    ["adk", "google-adk"],
    ["ms-agent-framework-dotnet", "maf-dotnet"],
    ["ms-agent-framework-python", "maf-python"],
    ["strands-python", "aws-strands"],
    ["agent-spec", "agent-spec-langgraph"],
    ["a2a-a2ui", "a2a"],
    ["a2a-middleware", "a2a"],
    ["mcp-apps", "mcp-apps"],
  ]),
);

/**
 * Reverse / corrected map used by audit.ts: showcase slug → candidate
 * examples/integrations dir name(s). Dead entries that pointed at
 * non-existent showcase packages (crewai-flows, agent-spec-langgraph,
 * mcp-apps) are intentionally excluded so audit.ts no longer emits
 * phantom "no examples source" anomalies for them.
 *
 * The `readonly string[]` element type plus Object.freeze on the
 * outer record make the whole structure immutable: you cannot
 * reassign a slug's array, and the arrays themselves are frozen
 * below.
 */
export const SLUG_TO_EXAMPLES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "langgraph-python": Object.freeze(["langgraph-python"]),
    "langgraph-typescript": Object.freeze(["langgraph-js"]),
    "langgraph-fastapi": Object.freeze(["langgraph-fastapi"]),
    mastra: Object.freeze(["mastra"]),
    "crewai-crews": Object.freeze(["crewai-crews"]),
    "pydantic-ai": Object.freeze(["pydantic-ai"]),
    agno: Object.freeze(["agno"]),
    llamaindex: Object.freeze(["llamaindex"]),
    "google-adk": Object.freeze(["adk"]),
    "ms-agent-dotnet": Object.freeze(["ms-agent-framework-dotnet"]),
    "ms-agent-python": Object.freeze(["ms-agent-framework-python"]),
    strands: Object.freeze(["strands-python"]),
  }) as Readonly<Record<string, readonly string[]>>;

/**
 * Fallback map used by validate-pins.ts: showcase slug → examples dir
 * name. These entries document known SLUG_MAP staleness — the slug
 * under `showcase/packages/` no longer matches the value in SLUG_MAP,
 * so we override here. If SLUG_MAP is refreshed, clean up these
 * entries accordingly.
 */
export const FALLBACK_MAP: Readonly<Record<string, string>> = Object.freeze({
  "crewai-crews": "crewai-crews",
  "ms-agent-dotnet": "ms-agent-framework-dotnet",
  "ms-agent-python": "ms-agent-framework-python",
  "pydantic-ai": "pydantic-ai",
  strands: "strands-python",
});
