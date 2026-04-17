/**
 * Shared slug / examples-directory mapping tables.
 *
 * Three tools consume these:
 *   - audit.ts               (showcase slug → examples dir name[s])
 *   - validate-pins.ts       (showcase slug → examples dir, via SLUG_MAP
 *                              inverse + FALLBACK_MAP override)
 *   - validate-parity.ts     (born-in-showcase membership)
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
 * ShowcaseSlug that appears in SLUG_MAP (as a value), SLUG_TO_EXAMPLES
 * (as a key), or FALLBACK_MAP (as a key) is an actual directory under
 * `showcase/packages/` — is enforced by slug-map.test.ts, not by the
 * type system.
 *
 * We deliberately keep this as a type alias (not a branded type) to
 * avoid forcing `as` casts on every external caller that builds a
 * slug from a `path.basename` or `fs.readdirSync` result. The safety
 * this trades away is recovered by `isShowcaseSlug` — a runtime
 * validator applied at API boundaries (see `ENTRIES` construction
 * below and the BORN_IN_SHOWCASE / SLUG_MAP assertions).
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
 * Runtime validator for a ShowcaseSlug. Applied at API boundaries
 * (SLUG entries construction, BORN_IN_SHOWCASE membership, callers
 * that accept user-supplied slug strings) to catch obvious garbage —
 * empty strings, whitespace, path separators — before it flows into
 * a filesystem path or a slug-indexed Map.
 *
 * The parameter type is `unknown` — this function sits at an API
 * boundary where TS guarantees are weakest (yaml.parse results, JSON
 * roundtrips, user-supplied strings). A widened param keeps the typeof
 * guard live rather than reducing to a dead check under `(s: string)`.
 *
 * The return signature is a user-defined type predicate (`s is
 * ShowcaseSlug`), so callers can narrow an `unknown` or `string` local
 * to a `ShowcaseSlug` without a cast after a successful check.
 */
export function isShowcaseSlug(s: unknown): s is ShowcaseSlug {
  if (typeof s !== "string") return false;
  if (s.length === 0) return false;
  // Reject whitespace and path separators: these are the characters
  // that would break `path.join(packages, slug)` most surprisingly
  // (newlines, spaces, `/`, `\`). We intentionally don't enforce a
  // strict kebab-case pattern — existing slugs include dots and
  // uppercase in related repos, so a strict regex would over-constrain.
  if (/[\s/\\]/.test(s)) return false;
  return true;
}

/**
 * Wrap a Set so mutation methods throw. Object.freeze on a Set does
 * not prevent .add/.delete — the set itself is frozen but its internal
 * slots are not. Casting to ReadonlySet is compile-time only.
 *
 * The returned type is ReadonlySet<T> (not Set<T>): callers that keep
 * a Set handle would bypass the runtime guard, so we force the narrow
 * type out of the helper.
 *
 * The replacement methods are installed with `writable: false` and
 * `configurable: false` so they cannot themselves be re-replaced
 * (`Object.defineProperty(set, "add", {value: realAdd})`) to restore
 * mutation. Without those descriptors, a later caller could silently
 * circumvent the freeze.
 */
function freezeSet<T>(s: Set<T>): ReadonlySet<T> {
  // Replace mutation methods FIRST, THEN freeze — Object.freeze locks
  // the object non-extensible, after which defineProperty throws.
  // `add` is typed to return the set so we match that signature but
  // throw before anything can observe the return value.
  const fail = (method: string) => () => {
    throw new TypeError(`Cannot ${method} frozen Set`);
  };
  const lock = { writable: false, configurable: false, enumerable: false };
  Object.defineProperty(s, "add", { ...lock, value: fail("add") });
  Object.defineProperty(s, "delete", { ...lock, value: fail("delete") });
  Object.defineProperty(s, "clear", { ...lock, value: fail("clear") });
  return Object.freeze(s);
}

function freezeMap<K, V>(m: Map<K, V>): ReadonlyMap<K, V> {
  const fail = (method: string) => () => {
    throw new TypeError(`Cannot ${method} frozen Map`);
  };
  const lock = { writable: false, configurable: false, enumerable: false };
  Object.defineProperty(m, "set", { ...lock, value: fail("set") });
  Object.defineProperty(m, "delete", { ...lock, value: fail("delete") });
  Object.defineProperty(m, "clear", { ...lock, value: fail("clear") });
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
 * Single source of truth for the showcase/examples mapping tables.
 * `SLUG_TO_EXAMPLES`, `FALLBACK_MAP`, and `BORN_IN_SHOWCASE` below are
 * derived from this array via reducers. Adding / removing / renaming
 * a slug happens in ONE place; before, three parallel maps had to be
 * edited in lockstep and silently fell out of sync.
 *
 * Entry shape:
 *   - slug           — the `showcase/packages/<slug>/` directory name
 *   - bornInShowcase — true iff the package has no examples/integrations
 *                      counterpart (skip instead of warn downstream).
 *                      When true, `examples` MUST be empty.
 *   - examples       — candidate dir names under `examples/integrations/`
 *                      (or `integrations/` in older trees). The FIRST
 *                      entry is treated as the preferred fallback.
 *   - fallback       — if true, expose an entry in FALLBACK_MAP that
 *                      points at `examples[0]`. FALLBACK_MAP documents
 *                      known SLUG_MAP staleness where the slug under
 *                      `showcase/packages/` no longer matches SLUG_MAP's
 *                      examples→slug direction.
 *
 * `SLUG_MAP` (examples → slug) is NOT derived — it reflects the
 * historical migrate-integration-examples.ts intent and is kept as a
 * standalone declaration so the "known stale" documentation at its
 * call sites in validate-pins.ts continues to hold.
 */
/**
 * Discriminated union form of SlugEntry.
 *
 * Three mutually-exclusive shapes:
 *   - born-in-showcase:   no examples counterpart, no fallback. The
 *                         `examples` tuple is statically empty and
 *                         `fallback` is never set.
 *   - examples (no fallback): a real examples dir exists but the
 *                             SLUG_MAP forward mapping is not stale.
 *                             The `examples` tuple is non-empty and
 *                             `fallback` is explicitly false.
 *   - examples + fallback:  SLUG_MAP is stale for this slug;
 *                             FALLBACK_MAP documents the correction.
 *                             The `examples` tuple is non-empty and
 *                             `fallback` is true; FALLBACK_MAP keys
 *                             off this variant.
 *
 * Modeled as a discriminated union so consumers can read
 * `e.examples[0]` on the fallback branch without a runtime length
 * assertion — the tuple type guarantees at least one element, and the
 * compiler narrows accordingly. Prior to this split, the flat
 * `examples: readonly ExamplesDir[]` forced a runtime check at the
 * FALLBACK_MAP reducer to rule out an empty tuple.
 */
type SlugEntry =
  | {
      readonly slug: ShowcaseSlug;
      readonly bornInShowcase: true;
      readonly examples: readonly [];
      readonly fallback: false;
    }
  | {
      readonly slug: ShowcaseSlug;
      readonly bornInShowcase: false;
      readonly examples: readonly [ExamplesDir, ...ExamplesDir[]];
      readonly fallback: boolean;
    };

const ENTRIES: readonly SlugEntry[] = [
  // Born-in-showcase packages have no examples/integrations counterpart.
  { slug: "ag2", bornInShowcase: true, examples: [], fallback: false },
  {
    slug: "claude-sdk-python",
    bornInShowcase: true,
    examples: [],
    fallback: false,
  },
  {
    slug: "claude-sdk-typescript",
    bornInShowcase: true,
    examples: [],
    fallback: false,
  },
  { slug: "langroid", bornInShowcase: true, examples: [], fallback: false },
  { slug: "spring-ai", bornInShowcase: true, examples: [], fallback: false },

  // Packages with a straightforward examples/integrations counterpart
  // whose dir name matches SLUG_MAP's examples→slug direction.
  {
    slug: "langgraph-python",
    bornInShowcase: false,
    examples: ["langgraph-python"],
    fallback: false,
  },
  {
    slug: "langgraph-typescript",
    bornInShowcase: false,
    examples: ["langgraph-js"],
    fallback: false,
  },
  {
    slug: "langgraph-fastapi",
    bornInShowcase: false,
    examples: ["langgraph-fastapi"],
    fallback: false,
  },
  {
    slug: "mastra",
    bornInShowcase: false,
    examples: ["mastra"],
    fallback: false,
  },
  {
    slug: "agno",
    bornInShowcase: false,
    examples: ["agno"],
    fallback: false,
  },
  {
    slug: "llamaindex",
    bornInShowcase: false,
    examples: ["llamaindex"],
    fallback: false,
  },
  {
    slug: "google-adk",
    bornInShowcase: false,
    examples: ["adk"],
    fallback: false,
  },

  // Packages whose showcase slug no longer matches SLUG_MAP's
  // examples→slug direction — these need FALLBACK_MAP entries so
  // validate-pins.ts can still resolve them.
  {
    slug: "crewai-crews",
    bornInShowcase: false,
    examples: ["crewai-crews"],
    fallback: true,
  },
  {
    slug: "pydantic-ai",
    bornInShowcase: false,
    examples: ["pydantic-ai"],
    fallback: true,
  },
  {
    slug: "ms-agent-dotnet",
    bornInShowcase: false,
    examples: ["ms-agent-framework-dotnet"],
    fallback: true,
  },
  {
    slug: "ms-agent-python",
    bornInShowcase: false,
    examples: ["ms-agent-framework-python"],
    fallback: true,
  },
  {
    slug: "strands",
    bornInShowcase: false,
    examples: ["strands-python"],
    fallback: true,
  },
];

// API-boundary validation: every slug that enters the derived maps
// must pass `isShowcaseSlug`. The loop runs at module load so a bad
// entry trips construction immediately rather than on first use.
// The "bornInShowcase implies empty examples" and "fallback implies
// non-empty examples" invariants are enforced statically by the
// SlugEntry discriminated union above and no longer need a runtime
// check here.
for (const e of ENTRIES) {
  if (!isShowcaseSlug(e.slug)) {
    throw new Error(
      `lib/slug-map: invalid ShowcaseSlug in ENTRIES: ${JSON.stringify(e.slug)}`,
    );
  }
}

/**
 * Packages intentionally without a Dojo (examples/integrations)
 * counterpart. They are the single source of truth for:
 *   - audit.ts  → skip the "missing examples/integrations counterpart"
 *                 anomaly;
 *   - validate-pins.ts → emit [SKIP] instead of [WARN].
 *
 * Derived from ENTRIES by filtering `bornInShowcase === true`.
 */
export const BORN_IN_SHOWCASE: ReadonlySet<ShowcaseSlug> = freezeSet(
  new Set<ShowcaseSlug>(
    ENTRIES.filter((e) => e.bornInShowcase).map((e) => e.slug),
  ),
);

/**
 * Forward map: examples/integrations directory name → showcase slug.
 * Mirrors migrate-integration-examples.ts (which does not export its
 * SLUG_MAP). Kept as a Map for O(1) lookup and so `.get()` returns
 * `ShowcaseSlug | undefined` unambiguously.
 *
 * This map is NOT derived from ENTRIES: it represents the historical
 * migration intent at the time showcase was split from
 * examples/integrations, and validate-pins.ts's comments explicitly
 * call out that it is "known stale". FALLBACK_MAP (derived from
 * ENTRIES) documents the corrections where SLUG_MAP no longer matches
 * the current slug under `showcase/packages/`.
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

// Construction-time assertion: every SLUG_MAP value is a valid slug.
for (const [, slug] of SLUG_MAP) {
  if (!isShowcaseSlug(slug)) {
    throw new Error(
      `lib/slug-map: invalid SLUG_MAP value: ${JSON.stringify(slug)}`,
    );
  }
}

/**
 * Reverse / corrected map used by audit.ts: showcase slug → candidate
 * examples/integrations dir name(s). Dead entries that pointed at
 * non-existent showcase packages (crewai-flows, agent-spec-langgraph,
 * mcp-apps) are intentionally excluded so audit.ts no longer emits
 * phantom "no examples source" anomalies for them.
 *
 * Derived from ENTRIES: each entry with non-empty `examples` becomes
 * `SLUG_TO_EXAMPLES[slug] = examples`. freezeMap2D freezes BOTH the
 * outer record (no adding/removing keys, no reassigning arrays) AND
 * each inner array (no element assignment). The compile-time
 * `Readonly<Record<..., readonly ExamplesDir[]>>` matches.
 */
export const SLUG_TO_EXAMPLES: Readonly<
  Record<ShowcaseSlug, readonly ExamplesDir[]>
> = freezeMap2D<ShowcaseSlug, ExamplesDir>(
  ENTRIES.reduce<Record<ShowcaseSlug, readonly ExamplesDir[]>>((acc, e) => {
    if (e.examples.length > 0) {
      acc[e.slug] = e.examples;
    }
    return acc;
  }, {}),
);

/**
 * Fallback map used by validate-pins.ts: showcase slug → examples dir
 * name. These entries document known SLUG_MAP staleness — the slug
 * under `showcase/packages/` no longer matches the value in SLUG_MAP,
 * so we override here. If SLUG_MAP is refreshed, clean up the
 * `fallback: true` flag on the corresponding ENTRIES row and this
 * map rebuilds to match.
 *
 * Derived from ENTRIES: each entry with `fallback: true` exposes
 * `FALLBACK_MAP[slug] = examples[0]`.
 */
export const FALLBACK_MAP: Readonly<Record<ShowcaseSlug, ExamplesDir>> =
  Object.freeze(
    ENTRIES.reduce<Record<ShowcaseSlug, ExamplesDir>>((acc, e) => {
      if (e.fallback) {
        acc[e.slug] = e.examples[0];
      }
      return acc;
    }, {}),
  );
