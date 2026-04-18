/**
 * Pin Validator
 *
 * Enforces the INTEGRATION-CHECKLIST.md rule:
 *   "Always pin agent framework and SDK versions to exact versions from
 *    the working Dojo example."
 *
 * For each showcase package at `showcase/packages/<slug>/`:
 *   1. Resolve its corresponding `examples/integrations/<source>/` dir.
 *   2. Read its dependency files (`package.json`, `requirements.txt`,
 *      `pyproject.toml`).
 *   3. For each agent-framework or CopilotKit SDK dep that appears in BOTH
 *      the showcase package and the Dojo example, verify the version
 *      specifier strings match EXACTLY AND are themselves exact pins (no
 *      ranges, no dist-tags, no workspace refs).
 *   4. Emit `[FAIL] <pkg>: <dep> pinned to X, Dojo has Y` for drift.
 *   5. Emit `[FAIL] <pkg>: <dep> absent in showcase but Dojo pins X` if a
 *      framework dep is present in the Dojo example but missing from the
 *      showcase package.
 *
 * Definition of "exact pin":
 *   - npm: bare semver (`1.2.3`, `1.2.3-beta.1`). NO `^`, `~`, `>=`, `*`,
 *          `latest`, `next`, `workspace:*`, URLs, or git refs.
 *   - Python: `==<version>`. NO `>=`, `~=`, `*`, or unpinned names.
 *
 * Usage:
 *   npx tsx showcase/scripts/validate-pins.ts
 *
 * Exit codes:
 *   0 — no FAIL violations (WARN/SKIP are non-fatal)
 *   1 — one or more FAIL violations (pin drift detected)
 *   2 — internal error (crash, unexpected exception). Distinct from 1 so
 *       CI callers can distinguish "pin drift" from "validator broken".
 *       Note: validate-parity.ts uses a different exit-code taxonomy
 *       (2=invalid-input, 3=unreadable, 4=internal); the tools are
 *       intentionally not aligned on code 2.
 *   3 — unreadable input (e.g. VALIDATE_PINS_REPO_ROOT points at a
 *       non-directory or a path the process cannot access). Distinct from
 *       2 so CI callers can route permissions/misconfig alerts separately
 *       from true crashes.
 *
 * Output routing:
 *   - [OK] and [SKIP] lines go to stdout.
 *   - [FAIL] and [WARN] lines go to stderr (per Unix convention).
 *
 * --- NOTE: SLUG_MAP staleness ---
 *
 * The `SLUG_MAP` imported from `./lib/slug-map.js` can drift from the
 * current set of directory names under `showcase/packages/`. The
 * `FALLBACK_MAP` in that shared module supplies the overrides
 * (e.g. `strands -> strands-python`, `ms-agent-dotnet ->
 * ms-agent-framework-dotnet`, `ms-agent-python ->
 * ms-agent-framework-python`). See
 * `.github/workflows/showcase_validate.yml` for the drift ratchet
 * tracking this refresh (#4047). Once SLUG_MAP is refreshed, the
 * FALLBACK_MAP entries fall through to the direct reverse-map lookup
 * and can be pruned.
 *
 * Several showcase packages are also "born-in-showcase" — they have no
 * Dojo counterpart and are skipped with [SKIP]. See `BORN_IN_SHOWCASE`
 * in `./lib/slug-map.js`.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BORN_IN_SHOWCASE, FALLBACK_MAP, SLUG_MAP } from "./lib/slug-map.js";

// SLUG_MAP / FALLBACK_MAP / BORN_IN_SHOWCASE are the single source of
// truth shared by audit.ts, validate-parity.ts, and this file. Re-exported
// at the bottom of this file so tests importing from "../validate-pins.js"
// see the same frozen tables.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Exit-code constants. See the module docstring for the full taxonomy.
// `as const` narrows each to its literal numeric type; `PinsExitCode` is
// the closed union so callers (and `process.exitCode` assignments in
// this file) cannot accidentally drift to an unrelated number. Adding
// a new exit code is a deliberate edit to both the constant and the
// union — a pure `const X = 4` cannot participate in the union.
const EXIT_OK = 0 as const;
const EXIT_DRIFT = 1 as const;
const EXIT_INTERNAL = 2 as const;
const EXIT_UNREADABLE = 3 as const;
type PinsExitCode =
  | typeof EXIT_OK
  | typeof EXIT_DRIFT
  | typeof EXIT_INTERNAL
  | typeof EXIT_UNREADABLE;

/**
 * Thrown when the repo-root input is present but unreadable or
 * structurally wrong (e.g. points at a file, EACCES, ENOTDIR). The
 * top-level catch uses `instanceof` to route these to EXIT_UNREADABLE
 * instead of EXIT_INTERNAL so CI callers can distinguish a permissions
 * misconfig from a true validator crash.
 */
class UnreadableInputError extends Error {
  /**
   * Optionally carries the partial report built up to the point the
   * infra error was observed. The top-level catch uses this to print
   * the FAIL/WARN/SKIP lines for slugs processed before the error so
   * operators don't lose diagnostic output when a single slug has an
   * infra problem mid-run. undefined for infra errors raised before
   * the slug loop started (e.g. bad VALIDATE_PINS_REPO_ROOT, missing
   * packages dir) where no report exists yet.
   */
  readonly partialReport?: Report;
  constructor(message: string, partialReport?: Report) {
    super(message);
    this.name = "UnreadableInputError";
    this.partialReport = partialReport;
  }
}

// REPO_ROOT resolution allows tests to override via env var. The override
// must be an absolute path pointing at an existing directory; a relative
// or non-existent override silently yielding an empty scan would turn a
// misconfiguration into a false green.
//
// Implementation note: `fs.existsSync` collapses ENOENT (does not
// exist) with EACCES (exists but unreadable by the current process)
// into a single false result, which produces a misleading "does not
// exist" error when the real problem is a permissions gap. Use
// `fs.statSync` with errno inspection so the message names the right
// failure mode.
function computeRepoRoot(): string {
  const override = process.env.VALIDATE_PINS_REPO_ROOT;
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error(
        `VALIDATE_PINS_REPO_ROOT must be an absolute path; got: ${override}`,
      );
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(override);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err && err.code === "ENOENT") {
        // ENOENT on the override is a bad-input/configuration error,
        // not a validator crash — route to EXIT_UNREADABLE (3) so CI
        // callers can distinguish misconfig from true internal errors.
        throw new UnreadableInputError(
          `VALIDATE_PINS_REPO_ROOT does not exist on disk: ${override}`,
        );
      }
      if (err && err.code === "EACCES") {
        throw new UnreadableInputError(
          `VALIDATE_PINS_REPO_ROOT exists but is not readable (permission denied): ${override}`,
        );
      }
      if (err && err.code === "ENOTDIR") {
        throw new UnreadableInputError(
          `VALIDATE_PINS_REPO_ROOT path component is not a directory: ${override}`,
        );
      }
      // Surface the underlying error message so the caller sees the
      // actual failure rather than a generic wrapper. Any stat failure
      // on the override path is an infra-class problem (the caller
      // configured a path we can't access), so route through
      // UnreadableInputError → EXIT_UNREADABLE (3) instead of letting
      // a plain Error misroute to EXIT_INTERNAL (2).
      const msg = err && err.message ? err.message : String(e);
      throw new UnreadableInputError(
        `VALIDATE_PINS_REPO_ROOT stat failed: ${override}: ${msg}`,
      );
    }
    // Override must be a directory — a file override would let the
    // rest of the validator run with a bogus REPO_ROOT and produce
    // misleading "nothing found" output rather than an immediate error.
    if (!st.isDirectory()) {
      throw new UnreadableInputError(
        `VALIDATE_PINS_REPO_ROOT is not a directory: ${override}`,
      );
    }
    return override;
  }
  return path.resolve(__dirname, "..", "..");
}

function paths() {
  const repoRoot = computeRepoRoot();
  return {
    REPO_ROOT: repoRoot,
    EXAMPLES_DIR: path.join(repoRoot, "examples", "integrations"),
    PACKAGES_DIR: path.join(repoRoot, "showcase", "packages"),
  };
}

// ---------------------------------------------------------------------------
// Slug resolution
// ---------------------------------------------------------------------------

// Reverse of SLUG_MAP: showcase slug → examples dir name(s).
// Precomputed at module load so each slug lookup is O(1) rather than
// a linear scan of SLUG_MAP. Frozen so runtime mutation attempts throw
// — the tables are meant to be effectively constant.
const REVERSE_MAP: Readonly<Record<string, readonly string[]>> = (() => {
  const reverse: Record<string, string[]> = {};
  for (const [example, slug] of SLUG_MAP) {
    if (!reverse[slug]) reverse[slug] = [];
    reverse[slug].push(example);
  }
  // Freeze inner arrays first, then outer record.
  for (const k of Object.keys(reverse)) Object.freeze(reverse[k]);
  return Object.freeze(reverse);
})();

export interface ResolveResult {
  exampleDir: string | null;
  // If a FALLBACK_MAP entry existed but pointed to a missing dir, the
  // caller should emit a distinct WARN with this path for diagnostics.
  missingFallbackTarget?: string;
}

function resolveExampleDirDetailed(
  showcaseSlug: string,
  pathsOverride?: ReturnType<typeof paths>,
): ResolveResult {
  if (BORN_IN_SHOWCASE.has(showcaseSlug)) return { exampleDir: null };

  // Accept an optional pre-computed `paths()` so validateAll can
  // compute it ONCE per run rather than re-validating
  // VALIDATE_PINS_REPO_ROOT per slug. Direct callers (tests, ad-hoc
  // use) may omit it and pay the per-call cost.
  const { EXAMPLES_DIR, REPO_ROOT } = pathsOverride ?? paths();

  // Strategy: explicit-fallback > reverse-SLUG_MAP > direct-name-match.
  // Each strategy can "fall through" if its candidate dir does not
  // exist on disk, so that a stale FALLBACK_MAP entry doesn't block a
  // later strategy from resolving correctly.
  //
  // Use `fs.statSync` + catch-ENOENT rather than `fs.existsSync` so
  // that a permission error (EACCES) does not silently collapse to the
  // "not present" branch. EACCES means "there is something there, but
  // this process can't read it" — treating it as "absent" hides real
  // misconfiguration. Other errors re-throw so they're surfaced at the
  // top level rather than quietly skipped.
  const existsAsDir = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory();
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err && err.code === "ENOENT") return false;
      // EACCES / ENOTDIR / EIO / ELOOP / etc. mean "there is something
      // at this path, but we can't read it". Route through
      // UnreadableInputError so the top-level catch maps this to
      // EXIT_UNREADABLE (3) — a permissions/infra misconfig — rather
      // than EXIT_INTERNAL (2) which signals a validator crash.
      const code = err && err.code ? err.code : "unknown";
      const msg = err && err.message ? err.message : String(e);
      throw new UnreadableInputError(
        `cannot stat candidate example dir (${code}): ${p}: ${msg}`,
      );
    }
  };

  // Strategy 1 — explicit fallback (documents SLUG_MAP staleness).
  const fallback = FALLBACK_MAP[showcaseSlug];
  let missingFallbackTarget: string | undefined;
  if (fallback) {
    const dir = path.join(EXAMPLES_DIR, fallback);
    if (existsAsDir(dir)) return { exampleDir: dir };
    // Display relative to REPO_ROOT so the WARN line reads
    // `examples/integrations/<name>` rather than the ambiguous
    // `integrations/<name>` (which hides where the missing dir is).
    missingFallbackTarget = path.relative(REPO_ROOT, dir);
  }

  // Strategy 2 — reverse-map lookup from SLUG_MAP.
  const candidates = REVERSE_MAP[showcaseSlug] || [];
  for (const cand of candidates) {
    const dir = path.join(EXAMPLES_DIR, cand);
    if (existsAsDir(dir)) return { exampleDir: dir, missingFallbackTarget };
  }

  // Strategy 3 — direct name match (common case: showcase slug ===
  // examples dir name).
  const direct = path.join(EXAMPLES_DIR, showcaseSlug);
  if (existsAsDir(direct)) return { exampleDir: direct, missingFallbackTarget };

  return { exampleDir: null, missingFallbackTarget };
}

function resolveExampleDir(showcaseSlug: string): string | null {
  return resolveExampleDirDetailed(showcaseSlug).exampleDir;
}

// ---------------------------------------------------------------------------
// Dependency extraction
// ---------------------------------------------------------------------------

// Heuristic: what counts as an agent framework / SDK that must be pinned.
// Applied as regex match (mostly anchored) against dependency NAMES only;
// versions are compared via exact string match per the
// INTEGRATION-CHECKLIST rule.
//
// Expected match set (non-exhaustive sanity list, with concrete examples
// rather than glob-like notation): @copilotkit/<anything>, copilotkit,
// @ag-ui/<anything>, ag-ui-<anything>, ag_ui_<anything>,
// @langchain/<anything>, langchain, langchain-<anything>, langgraph,
// langgraph-<anything>, langsmith, @mastra/<anything>, mastra, crewai,
// crewai-<anything>, pydantic-ai, pydantic-ai-<anything>, agno,
// llama-index, llama-index-<anything>, llama_index, llama_index_<anything>,
// llamaindex, google-adk, google-genai, strands-agents,
// strands-agents-<anything>, agent-framework, agent-framework-<anything>,
// @ai-sdk/<anything>, ai, @hashbrownai/<anything>, @anthropic-ai/<anything>,
// anthropic, openai, ag2, langroid, spring-ai, spring-ai-<anything>, and
// Spring's Maven coordinate form `org.springframework.ai:<artifact>` which
// appears in Java manifests as a colon-delimited group:artifact string.
const FRAMEWORK_PATTERNS: Array<RegExp> = [
  // CopilotKit SDK
  /^@copilotkit\//,
  /^copilotkit$/,
  // AG-UI
  /^@ag-ui\//,
  /^ag-ui[-_]/,
  /^ag_ui[-_]/,
  // LangChain / LangGraph
  /^@langchain\//,
  /^langchain$/,
  /^langchain-/,
  /^langgraph$/,
  /^langgraph-/,
  /^langgraph_/,
  /^langsmith$/,
  // Mastra
  /^@mastra\//,
  /^mastra$/,
  // CrewAI
  /^crewai$/,
  /^crewai-/,
  // Pydantic AI
  /^pydantic-ai$/,
  /^pydantic-ai-/,
  // Agno
  /^agno$/,
  // LlamaIndex (dash and underscore forms)
  /^llama-index$/,
  /^llama-index-/,
  /^llama_index$/,
  /^llama_index_/,
  /^llamaindex$/,
  // Google ADK / GenAI
  /^google-adk$/,
  /^google-genai$/,
  // Strands
  /^strands-agents$/,
  /^strands-agents-/,
  // Microsoft Agent Framework
  /^agent-framework$/,
  /^agent-framework-/,
  // AI SDK (Vercel)
  /^@ai-sdk\//,
  /^ai$/,
  // Hashbrown / A2UI renderers travel with CopilotKit
  /^@hashbrownai\//,
  // Anthropic / OpenAI SDKs used directly by agents
  /^@anthropic-ai\//,
  /^anthropic$/,
  /^openai$/,
  // Other frameworks that show up in born-in-showcase packages
  /^ag2$/,
  /^ag2-/,
  /^langroid$/,
  /^langroid-/,
  // Spring AI (Java coordinates appear with these prefixes)
  /^spring-ai$/,
  /^spring-ai-/,
  // Maven coordinate form for Spring AI: `group:artifact` with group
  // prefix `org.springframework.ai`. Matches `org.springframework.ai:foo`
  // for any artifact `foo`.
  /^org\.springframework\.ai:/,
];

function isFrameworkDep(name: string): boolean {
  return FRAMEWORK_PATTERNS.some((re) => re.test(name));
}

export interface DepMap {
  [name: string]: string; // name -> raw version specifier string
}

/**
 * Extended parse result: includes the DepMap plus advisory diagnostics.
 * Callers use these to surface WARN lines even when the parse did not
 * outright fail. Tests still assert against the returned DepMap shape.
 */
export interface ParseResult {
  deps: DepMap;
  /**
   * Entries the parser intentionally skipped (e.g. Poetry git-only deps,
   * inline tables with no `version`, malformed requirements.txt lines).
   * Non-fatal but surface as [WARN] in validateAll so CI has a paper
   * trail.
   */
  skipped: Array<{ name: string; reason: string }>;
  /**
   * Fully unparseable lines we dropped from requirements.txt. One entry
   * per dropped line.
   */
  dropped: string[];
}

/**
 * Parse a package.json into a DepMap. May throw on I/O failure or
 * malformed JSON; callers that tolerate partial failure should catch
 * and record the error. Runtime validates the parsed JSON is a plain
 * object (not null / array / scalar) before property access, and that
 * each entry in `dependencies` / `devDependencies` / `peerDependencies`
 * is a string. Non-string dep values throw.
 *
 * Note: dep values are validated as strings, but the shape of each
 * individual key (semver validity, registry name validity, etc.) is
 * NOT validated here — that is the caller's responsibility.
 *
 * @throws Error on fs.readFileSync / JSON.parse failure, when the
 *         parsed value is not a plain object, or when any declared
 *         dep value is not a string.
 */
function parsePackageJson(file: string): DepMap {
  const raw = fs.readFileSync(file, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `expected JSON object at top level, got ${
        parsed === null
          ? "null"
          : Array.isArray(parsed)
            ? "array"
            : typeof parsed
      }`,
    );
  }
  // After the guard above we know `parsed` is a plain (non-null,
  // non-array) object. Treat it as `Record<string, unknown>` so every
  // bucket lookup is typed as `unknown` and MUST be shape-checked by
  // validateBucket below. Casting to a specific shape
  // (`{ dependencies?: Record<string, unknown>; … }`) would imply
  // pre-validated shape and invite callers to trust the cast without
  // runtime checks.
  const pkg: Record<string, unknown> = parsed as Record<string, unknown>;

  // Validate inner dep values are strings. A package.json with
  // non-string dep values (objects, numbers, nulls) is structurally
  // invalid per the npm schema; the JS spread below would otherwise
  // silently admit them into the DepMap and downstream comparisons
  // would throw or misbehave.
  const validateBucket = (
    bucket: unknown,
    bucketName: string,
  ): Record<string, string> | undefined => {
    if (bucket === undefined) return undefined;
    if (
      typeof bucket !== "object" ||
      bucket === null ||
      Array.isArray(bucket)
    ) {
      throw new Error(
        `expected '${bucketName}' to be an object of name→string, got ${
          bucket === null
            ? "null"
            : Array.isArray(bucket)
              ? "array"
              : typeof bucket
        }`,
      );
    }
    const ok: Record<string, string> = {};
    for (const [k, v] of Object.entries(bucket)) {
      if (typeof v !== "string") {
        throw new Error(
          `expected '${bucketName}.${k}' to be a string, got ${typeof v}`,
        );
      }
      ok[k] = v;
    }
    return ok;
  };

  const deps = validateBucket(pkg.dependencies, "dependencies");
  const peerDeps = validateBucket(pkg.peerDependencies, "peerDependencies");
  const devDeps = validateBucket(pkg.devDependencies, "devDependencies");

  // Merge dependencies, devDependencies, and peerDependencies. Frameworks
  // in JS apps often live in devDeps (e.g. Next.js starters), and pinning
  // rules apply to them all. On overlap, later spread wins: dev > peer >
  // runtime. That's fine because (a) the caller applies first-writer-wins
  // at the FILE level, and (b) in practice these rarely overlap within
  // one file.
  return {
    ...deps,
    ...peerDeps,
    ...devDeps,
  };
}

/**
 * PEP 503 name normalization: lowercase, collapse runs of `-`, `_`, `.`
 * into a single `-`. Used to compare Python dep names across underscore /
 * hyphen spellings (e.g. `langgraph_checkpoint` vs `langgraph-checkpoint`).
 */
function canonicalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/**
 * Returns true iff `spec` is a monorepo workspace reference that the
 * validator intentionally does NOT pin-check. Workspace refs (e.g.
 * `workspace:*`, `workspace:^`, `workspace:1.2.3`) are resolved by the
 * package manager against the local monorepo, not published — there is
 * no "pin" semantics to check. Handled out-of-band from isExactSpec
 * because isExactSpec merely classifies, while this classifies AND
 * indicates the caller should emit a [SKIP] rather than a [FAIL].
 */
function isWorkspaceRef(spec: string): boolean {
  if (!spec) return false;
  return /^workspace:/.test(spec.trim());
}

/**
 * Returns true iff `spec` is an EXACT pin per the INTEGRATION-CHECKLIST rule.
 *
 * Accepts:
 *   - Bare semver-ish strings: "1.2.3", "0.2.14", "1.0.0-beta.1"
 *   - PEP 440 forms: "1.2.3.post1", "1.2.3.dev1", "1.2.3rc1", "1.2.3a1",
 *                    "1.2.3b2"
 *   - Python exact specs: "==1.2.3", "===1.2.3", "==0.2.14", "==1.2.3rc1"
 *
 * Rejects:
 *   - Range operators: ^, ~, >=, <=, >, <, ~=, !=
 *   - X-ranges / wildcards: "1.x", "1.2.x", "1.2.*", "*", "X.X.X"
 *   - Dist-tags: "latest", "next", "" (empty)
 *   - Workspace/monorepo refs: "workspace:*", "workspace:^", "file:"
 *   - URLs / git refs / paths
 *   - Malformed Python `==` bodies without a full MAJOR.MINOR (e.g. `==0`).
 */
function isExactSpec(spec: string): boolean {
  if (!spec) return false;
  const trimmed = spec.trim();
  if (!trimmed) return false;

  // Reject any wildcard marker anywhere in the string. `*`, `x`, or `X`
  // appearing as a version component (e.g. "1.x", "1.2.*") is never exact.
  // The Python `==` form also cannot contain wildcards.
  if (/(^|[.\-_+])[xX*]([.\-_+]|$)/.test(trimmed)) return false;
  if (/\*/.test(trimmed)) return false;

  // Python == / === exact form.
  // Body must match MAJOR.MINOR with optional numeric sub-segments,
  // an optional PEP 440 pre-release tag (`a1`, `b2`, `rc3`, etc.)
  // directly attached, an optional `.postN` / `.devN` segment, an
  // optional `-pre` / `+local` suffix. The regex is anchored end-to-end
  // so degenerate bodies like `==1.2.foo` (dotted letter segment that
  // is not a recognized PEP 440 keyword) or `==1.2abc!` (illegal
  // trailing punctuation) are rejected — a non-anchored `^\d+\.\d+`
  // or a too-permissive tail like `(?:[-+.A-Za-z0-9]+)*` would accept
  // those and mis-classify them as exact pins.
  const pyMatch = trimmed.match(/^={2,3}\s*(\S+)$/);
  if (pyMatch) {
    return /^\d+\.\d+(?:\.\d+)*(?:[A-Za-z]+\d*)?(?:\.(?:post|dev)\d*)?(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(
      pyMatch[1],
    );
  }

  // Anything starting with a range operator is NOT exact.
  if (/^[\^~<>!]/.test(trimmed)) return false;
  if (/^(>=|<=|==|~=|!=)/.test(trimmed)) return false;

  // Tags, workspace refs, URLs, paths.
  if (/^[A-Za-z]/.test(trimmed)) {
    // Starts with a letter: dist-tag like "latest" or "next", or
    // "workspace:*", "file:...", "github:user/repo", etc.
    return false;
  }

  // Bare version must start with a digit and contain no ranges/spaces.
  if (!/^\d/.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return false;
  if (/[|]{1,2}/.test(trimmed)) return false; // "1.2.3 || 2.0.0"
  // Comma-joined ranges (Poetry / PEP 440): "1.2.3,>=1.0" is composed
  // of two constraints and cannot be a single exact pin.
  if (/,/.test(trimmed)) return false;

  // Bare version shape: MAJOR.MINOR[.PATCH] with an optional
  // pre-release / build / PEP 440 suffix. Enforced by a concrete
  // semver-shape regex so only digit-dotted-digit forms (plus
  // permitted suffixes) pass, rejecting exotic bare-letter tails
  // like `1x`, `2X`, and `1e2`.
  //
  // MAJOR.MINOR is required for bare versions so bare-spec acceptance
  // is symmetric with the Python `==` form above (which rejects `==1`).
  // MAJOR-only like `"1"` is rejected on both paths, keeping
  // drift-report behavior consistent across ecosystems.
  if (!/^\d+\.\d+(?:\.\d+)?(?:[-+.][A-Za-z0-9.-]+)*$/.test(trimmed)) {
    return false;
  }

  return true;
}

// Parse a requirements.txt line. Strip comments, extras, env markers,
// pip hash flags, index-url flags, and `--find-links` flags.
//
// Returns:
//   - `[name, versionSpec]` on a valid `name<spec>` form; `versionSpec`
//     MAY be an empty string when the line is name-only (e.g.
//     `langgraph`). The file-level walker is responsible for surfacing
//     these as `skipped[]` since an empty spec is not a pin.
//   - `null` when the line is unparseable (editable install, URL-only,
//     operator-leading, pure flag line, etc.).
function parseRequirementsLine(line: string): [string, string] | null {
  // Strip trailing comments.
  const stripped = line.replace(/#.*$/, "").trim();
  if (!stripped) return null;
  // Editable installs / URLs — not supported.
  if (/^-e\b/.test(stripped) || /^(https?|git\+)/.test(stripped)) return null;

  // Split on environment marker (;) and take the LHS.
  const lhs = stripped.split(";")[0].trim();

  // Strip pip-install flags attached to a single line:
  //   `--hash=sha256:...`, `--index-url=...`, `--extra-index-url=...`,
  //   `--find-links=...`. These appear AFTER the spec. Single-pass
  //   alternation avoids order-dependency between sequential replaces
  //   (e.g. a `--extra-index-url=...` substring being partially consumed
  //   by a naïve `--index-url=\S+` regex run first).
  const flagsStripped = lhs
    .replace(/\s+--(?:hash|index-url|extra-index-url|find-links)=\S+/g, "")
    .trim();

  // Match: name [extras] version-spec
  // name characters: letters, digits, -, _, .
  const match = flagsStripped.match(
    /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/,
  );
  if (!match) return null;
  const name = match[1];
  const spec = (match[2] || "").trim();
  return [name, spec];
}

/**
 * Parse a requirements.txt file into a DepMap. Returns a ParseResult
 * with the DepMap plus:
 *   - `skipped`: name-only requirements (e.g. `langgraph` with no
 *     version spec) that the parser intentionally did NOT admit to the
 *     DepMap. The file-level walker surfaces these as [WARN] so
 *     operators see the manifest has an unpinned dep rather than the
 *     entry being silently dropped.
 *   - `dropped`: fully unparseable lines — caller surfaces as [WARN].
 *
 * @throws Error on fs.readFileSync failure.
 */
function parseRequirementsTxtDetailed(file: string): ParseResult {
  const raw = fs.readFileSync(file, "utf-8");
  const out: DepMap = {};
  const skipped: Array<{ name: string; reason: string }> = [];
  const dropped: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    // Empty and comment lines are legitimate — don't flag them as dropped.
    const stripped = line.replace(/#.*$/, "").trim();
    if (!stripped) continue;
    // Editable installs / URLs are valid requirements but we cannot
    // extract a pin from them; they're intentional non-deps, not drops.
    if (/^-e\b/.test(stripped) || /^(https?|git\+)/.test(stripped)) continue;
    const parsed = parseRequirementsLine(line);
    if (parsed) {
      // First-writer-wins within a file (a given dep may appear
      // multiple times with different pins; the earlier line wins).
      // NOTE: pip's own resolver does not define a "first vs last
      // writer" rule across identical lines — re-declaration within a
      // single requirements file is already ambiguous input, and real
      // installs are normally deduped upstream. We pick first-writer
      // here so the rule matches collectDepsFromDir's first-writer
      // file-level precedence (agent-scope wins over root-scope). If
      // a concrete case demands pip's actual semantics, replace this
      // block rather than layering an exception.
      const [name, spec] = parsed;
      if (!(name in out)) {
        if (!spec) {
          // Name-only line (e.g. `langgraph` with no spec): surface as
          // skipped since it's not pinning anything. See
          // INTEGRATION-CHECKLIST rule about exact pins.
          skipped.push({
            name,
            reason: "name-only requirement (no version)",
          });
        } else {
          out[name] = spec;
        }
      }
    } else {
      dropped.push(stripped);
    }
  }
  return { deps: out, skipped, dropped };
}

/**
 * Thin compatibility wrapper: returns a DepMap for callers that do not
 * care about dropped-line or skipped-line diagnostics. Internally
 * delegates to the detailed form.
 *
 * NOTE: This wrapper does NOT tolerate silent data loss. If the
 * underlying detailed parse produces any `skipped[]` or `dropped[]`
 * entries, this wrapper THROWS so the caller is forced to switch to
 * `parseRequirementsTxtDetailed` rather than quietly losing those
 * diagnostics. Callers that may legitimately encounter skipped/dropped
 * entries MUST call `parseRequirementsTxtDetailed` directly.
 *
 * @throws Error on fs.readFileSync failure.
 * @throws Error when the file contains skipped or dropped entries
 *         (use parseRequirementsTxtDetailed instead).
 */
function parseRequirementsTxt(file: string): DepMap {
  const detailed = parseRequirementsTxtDetailed(file);
  if (detailed.skipped.length > 0 || detailed.dropped.length > 0) {
    throw new Error(
      `parseRequirementsTxt: ${file} produced ${detailed.skipped.length} skipped and ` +
        `${detailed.dropped.length} dropped entries; use parseRequirementsTxtDetailed ` +
        `to access them instead of silently discarding.`,
    );
  }
  return detailed.deps;
}

/**
 * Scan `raw` starting at `openBracketIdx` (which must point at a `[`
 * character) and return the index of the matching closing `]`, skipping
 * over any `]` or `[` embedded in single- or double-quoted strings.
 * Returns -1 if no matching bracket is found before end-of-string OR
 * before a new TOML table header (`\n[...]` at column 0).
 *
 * This exists because the PEP 621 and PEP 621-extras arrays can legally
 * contain entries like `"langchain[all]==1.2.3"` where the bracket
 * character appears inside a quoted string. A non-greedy `[\s\S]*?\]`
 * regex silently truncates such arrays at the first `]` and drops
 * everything after — a silent miss that makes the validator emit [OK]
 * against incomplete dependency sets.
 *
 * The scanner handles:
 *   - Basic double-quoted strings: `"..."` (escape `\"` permitted).
 *   - Basic single-quoted strings: `'...'` (escape `\'` permitted).
 *   - TOML comments: `#` to end-of-line are ignored outside strings so
 *     a `]` that appears inside a comment does NOT satisfy the search.
 *   - Table header termination: a `\n[` at column 0 while still at
 *     depth > 0 means the array was never closed before the next
 *     table header — return -1 so the caller can throw.
 *
 * It does NOT handle TOML multi-line basic strings (`"""..."""`) or
 * nested arrays spanning multiple table bodies. A real TOML tokenizer
 * would be more correct; the tradeoff is accepted because our fixtures
 * are simple single-section arrays of strings.
 */
function findMatchingBracket(raw: string, openBracketIdx: number): number {
  let depth = 0;
  let i = openBracketIdx;
  while (i < raw.length) {
    const ch = raw[i];
    // A new TOML table header `\n[` at depth >= 1 means the current
    // array was never closed. The opening `[` of the header does NOT
    // count as a nested-array bump — it's a new section starting.
    // Only trigger this when we've already consumed the opening
    // bracket (i > openBracketIdx) and the next char is `[`.
    if (ch === "\n" && depth >= 1 && i + 1 < raw.length && raw[i + 1] === "[") {
      return -1;
    }
    if (ch === '"') {
      // Skip basic-string. Escapes: `\\` and `\"`.
      i += 1;
      while (i < raw.length) {
        const c = raw[i];
        if (c === "\\" && i + 1 < raw.length) {
          i += 2;
          continue;
        }
        if (c === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "'") {
      // Skip literal-string.
      i += 1;
      while (i < raw.length && raw[i] !== "'") i += 1;
      if (i < raw.length) i += 1;
      continue;
    }
    if (ch === "#") {
      // Skip to end-of-line. A `]` inside a comment must NOT close
      // the array.
      while (i < raw.length && raw[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "[") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

/**
 * Extract quoted-string entries out of a TOML array body (the text
 * between an opening `[` and its matching `]`), dispatching each entry
 * through `parseRequirementsLine` and merging into `out` (first-writer-
 * wins). Unparseable non-empty entries go into `dropped`.
 *
 * Name-only entries (e.g. bare `"langgraph"` in the array) are pushed
 * to `skipped[]` rather than silently admitted to `out` with an empty
 * spec. This mirrors `parseRequirementsTxtDetailed`'s file-level
 * handling so pyproject and requirements.txt report the same
 * diagnostics for the same input.
 */
function ingestArrayBody(
  body: string,
  out: DepMap,
  dropped: string[],
  skipped: Array<{ name: string; reason: string }>,
): void {
  const quoteRe = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(body))) {
    const entry = m[1] ?? m[2] ?? "";
    const parsed = parseRequirementsLine(entry);
    if (parsed) {
      const [name, spec] = parsed;
      if (!(name in out)) {
        if (!spec) {
          // Name-only entry — not pinning anything. Surface as
          // skipped so a [WARN] is emitted, matching requirements.txt
          // handling. Without this, the DepMap silently gained an
          // entry with an empty spec and downstream error messages
          // read `(empty)` without explaining the cause.
          skipped.push({
            name,
            reason: "name-only requirement (no version)",
          });
        } else {
          out[name] = spec;
        }
      }
    } else if (entry.trim()) {
      dropped.push(entry);
    }
  }
}

/**
 * Extremely small pyproject.toml reader. Handles:
 *
 *   - Top-level `[project]` dependencies array (PEP 621).
 *   - Top-level `[project.optional-dependencies]` tables (PEP 621 extras)
 *     — every subkey's array is scanned.
 *   - Poetry `[tool.poetry.dependencies]` tables, including
 *     `[tool.poetry.group.<name>.dependencies]`.
 *
 * We avoid adding a full TOML dependency by using targeted regexes. The
 * parser stops at the NEXT TOP-LEVEL table header (e.g. `[tool.foo]`) —
 * crucially NOT at dotted subtables like `[project.optional-dependencies]`,
 * which are children of `[project]`.
 *
 * @throws Error on fs.readFileSync failure, or when a top-level
 *         `dependencies = [` array in `[project]` is opened but a
 *         matching `]` is never found by the quote-aware scanner.
 */
function parsePyprojectTomlDetailed(file: string): ParseResult {
  const raw = fs.readFileSync(file, "utf-8");
  const out: DepMap = {};
  const skipped: Array<{ name: string; reason: string }> = [];
  const dropped: string[] = [];

  // --- PEP 621: [project] table ---
  // Find the [project] section body, stopping at the next header of any
  // kind — whether a plain table like `[tool]` or a dotted table like
  // `[tool.poetry]` / `[project.optional-dependencies]`. Dotted
  // subtables under `[project]` (e.g. `[project.optional-dependencies]`)
  // are handled by separate scanners that run against the raw file, so
  // it is safe — and in fact required — to terminate [project] body at
  // the FIRST subsequent `[...]` header. Otherwise `dependencies = [`
  // keys inside Poetry group subtables can leak into PEP 621 parsing.
  const projectBodyRe =
    /(?:^|\n)\[project\][^\n]*\n([\s\S]*?)(?=\n\[[^\]\n]+\]|\n*$)/;
  const projectMatch = raw.match(projectBodyRe);
  if (projectMatch) {
    const section = projectMatch[1];

    // Find `dependencies = [` using a regex anchored to a line boundary
    // so we don't accidentally match `optional-dependencies = [` or
    // `dev-dependencies = [`. We need the POSITION of the opening `[`
    // so we can hand it to `findMatchingBracket`, which understands
    // quoted-string embedded brackets (e.g. `"langchain[all]==1.2.3"`).
    const depsKeyRe = /(?:^|\n)(dependencies\s*=\s*)\[/;
    const km = depsKeyRe.exec(section);
    if (km) {
      const bracketIdx = km.index + km[0].length - 1;
      const closeIdx = findMatchingBracket(section, bracketIdx);
      if (closeIdx < 0) {
        throw new Error(
          `malformed pyproject.toml: [project] 'dependencies = [' opened but never closed (missing matching ']')`,
        );
      }
      const body = section.slice(bracketIdx + 1, closeIdx);
      ingestArrayBody(body, out, dropped, skipped);
    }
  }

  // --- PEP 621: [project.optional-dependencies] subsections ---
  // Under PEP 621, optional dependencies are declared as:
  //   [project.optional-dependencies]
  //   extra_a = ["foo==1.0", "bar==2.0"]
  //   extra_b = ["baz==3.0"]
  // Each key's value is a string array; the array entries use the same
  // requirements.txt grammar as [project].dependencies. We scan each
  // key's array separately so optional-only framework deps are also
  // subject to pin drift checks.
  const optHeaderRe = /(?:^|\n)\[project\.optional-dependencies\][^\n]*\n/g;
  let optHdr: RegExpExecArray | null;
  while ((optHdr = optHeaderRe.exec(raw))) {
    const bodyStart = optHdr.index + optHdr[0].length;
    const rest = raw.slice(bodyStart);
    const nextHeader = rest.match(/\n\[/);
    const body = nextHeader ? rest.slice(0, nextHeader.index) : rest;
    // Walk subkey assignments `extra_name = [`. Use a regex to locate
    // each opening `[` but hand the closing-bracket search off to the
    // quote-aware scanner so embedded `]` characters (e.g. inside
    // `"langchain[all]==1.2.3"`) don't truncate the array and silently
    // drop subsequent entries.
    const subkeyKeyRe = /([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*\[/g;
    let sm: RegExpExecArray | null;
    while ((sm = subkeyKeyRe.exec(body))) {
      const bracketIdx = sm.index + sm[0].length - 1;
      const closeIdx = findMatchingBracket(body, bracketIdx);
      if (closeIdx < 0) {
        // Unterminated extras array is genuinely malformed TOML — the
        // array's contents are truncated, so we cannot faithfully
        // report what was declared. Throw a parseError so the caller
        // surfaces a FAIL; downgrading to `dropped[]` (WARN) lets
        // silent data loss pass CI.
        throw new Error(
          `malformed pyproject.toml: [project.optional-dependencies].${sm[1]} opened '[' but never closed (missing ']')`,
        );
      }
      const arrBody = body.slice(bracketIdx + 1, closeIdx);
      ingestArrayBody(arrBody, out, dropped, skipped);
      // Advance past the close so the next subkey is found after it.
      subkeyKeyRe.lastIndex = closeIdx + 1;
    }
  }

  // --- Poetry: [tool.poetry.dependencies] AND
  //              [tool.poetry.group.<name>.dependencies] tables ---
  //
  // Poetry supports grouped dev/agent/etc. dependency sections under
  // `[tool.poetry.group.*.dependencies]`. Missing these sections causes the
  // validator to silently skip group-pinned frameworks, so we walk each
  // matching table header.
  //
  // Poetry version-string semantics: a bare version like `"1.2.3"` means
  // caret (`^1.2.3`) in Poetry — NOT an exact pin. We prefix such values
  // with `^` before storing so downstream `isExactSpec` correctly rejects
  // them. Tradeoff: the stored spec no longer textually matches the raw
  // pyproject.toml token, which is visible in FAIL messages that read
  // e.g. "pinned to ^1.2.3" when the file says `"1.2.3"`. This is
  // accurate (the effective spec IS `^1.2.3` per Poetry rules), but can
  // confuse an operator grepping the source — hence the explicit note.
  // Operator-prefixed strings (`^`, `~`, `>=`, `==`, ...) are stored
  // verbatim.
  const poetryHeaderRe =
    /(?:^|\n)\[tool\.poetry(?:\.group\.[A-Za-z0-9_-]+)?\.dependencies\][^\n]*\n/g;
  let headerMatch: RegExpExecArray | null;
  while ((headerMatch = poetryHeaderRe.exec(raw))) {
    const bodyStart = headerMatch.index + headerMatch[0].length;
    // Body ends at the next table header ([something]) or end of file.
    const rest = raw.slice(bodyStart);
    const nextHeader = rest.match(/\n\[/);
    const body = nextHeader ? rest.slice(0, nextHeader.index) : rest;

    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      // key = value   (value may be a string or an inline table like
      // `{ version = "^1.0", extras = [...] }`)
      const kvMatch = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.*)$/);
      if (!kvMatch) continue;
      const name = kvMatch[1];
      // "python" is the interpreter constraint, not a dependency.
      if (name === "python") continue;
      let value = kvMatch[2].trim();

      let spec = "";
      if (value.startsWith("{")) {
        // Inline table. Pull `version = "..."` or `version = '...'` out
        // of it; if absent (e.g. git-only / path-only / branch-only),
        // record as skipped. TOML permits both single and double quotes
        // for basic strings and the stdlib / Poetry itself both accept
        // either form.
        const vm = value.match(/version\s*=\s*(?:"([^"]*)"|'([^']*)')/);
        if (vm) {
          spec = vm[1] ?? vm[2] ?? "";
        } else if (/\bgit\s*=/.test(value)) {
          skipped.push({
            name,
            reason: "Poetry git-only dep (no version)",
          });
          continue;
        } else if (/\bpath\s*=/.test(value)) {
          skipped.push({
            name,
            reason: "Poetry path-only dep (no version)",
          });
          continue;
        } else {
          skipped.push({
            name,
            reason: "Poetry inline table missing version",
          });
          continue;
        }
      } else if (value.startsWith("[")) {
        // Array-form Poetry dep: `foo = ["^1.0", "^2.0"]` expresses a
        // multi-constraint OR. There is no single "pinned version" for
        // such a declaration, so the validator cannot meaningfully
        // compare it to an exact Dojo pin. Surface as skipped so a
        // [WARN] is emitted — silently dropping these would let pin
        // drift slip through undetected.
        skipped.push({
          name,
          reason: "Poetry array-form dep (multi-constraint, not an exact pin)",
        });
        continue;
      } else if (value.startsWith('"') || value.startsWith("'")) {
        const q = value[0];
        const end = value.indexOf(q, 1);
        if (end > 0) {
          spec = value.slice(1, end);
        } else {
          // Opening quote but no matching closing quote before
          // end-of-line — the string is unterminated. Record as a
          // distinct `unterminated string` reason so the WARN line
          // names the actual fault rather than conflating with the
          // empty-version-string branch below.
          skipped.push({
            name,
            reason: "Poetry unterminated string value",
          });
          continue;
        }
      } else {
        // Not a string — skip (booleans, numbers, etc.). Record the
        // dep in `skipped[]` (rather than silently dropping) so
        // operators reading the WARN output see a malformed value
        // rather than a seemingly-clean file.
        const rawType = /^(true|false)\b/.test(value)
          ? "boolean"
          : /^-?\d/.test(value)
            ? "number"
            : value === "" || value.startsWith("\n")
              ? "empty"
              : typeof value;
        skipped.push({
          name,
          reason: `Poetry non-string dep value (got ${rawType})`,
        });
        continue;
      }

      // Trim at parse time so `isExactSpec` and downstream comparisons
      // don't have to worry about quoted whitespace (e.g. `" 1.2.3"`).
      spec = spec.trim();

      // Empty spec (e.g. `foo = ""`) is malformed — record as skipped
      // so the caller can surface a [WARN]. Without this, an empty
      // string silently stored would later be rendered as "(empty)"
      // in error messages without explaining WHY the spec was empty.
      if (!spec) {
        skipped.push({ name, reason: "Poetry empty version string" });
        continue;
      }

      // Poetry bare-version semantics: `"1.2.3"` means `^1.2.3`. Prefix
      // with `^` so it is correctly classified as non-exact by
      // `isExactSpec`. Anything already starting with an operator
      // character is stored verbatim.
      //
      // Caveat: a value that starts with a digit may still be a
      // composed range that Poetry stores in a single string — e.g.
      // `"1.2.3,>=1.0"` (comma-joined), `"1.2.3 || 2.0.0"` (pipe OR),
      // or a space-separated range. Prefixing any of these with `^`
      // produces a nonsense spec (e.g. `^1.2.3 || 2.0.0`). Only
      // prefix when the value is a lone bare version — no commas,
      // whitespace, `||` OR, or any range/PEP 440 operator character
      // (`<`, `>`, `~`, `^`, `!`). Everything else is stored
      // verbatim; `isExactSpec` will classify it correctly on the
      // range-operator / comma / whitespace / pipe paths.
      if (
        /^\d/.test(spec) &&
        !spec.includes(",") &&
        !spec.includes(" ") &&
        !spec.includes("||") &&
        !/[<>~^!]/.test(spec)
      ) {
        spec = "^" + spec;
      }

      // First-writer-wins within this file (top-level deps declared before
      // group deps keep their spec).
      if (!(name in out)) out[name] = spec;
    }
  }

  // Defensive guard: a file that *declares* a `dependencies = …` key
  // (under `[project]` or `[tool.poetry*]`) but produced ZERO extracted
  // entries AND no skipped/dropped diagnostics almost certainly means
  // the regex-based parser could not destructure that declaration —
  // e.g. `dependencies = "malformed-string"` (wrong TOML type), an
  // inline-table form we don't support, or some other shape the
  // targeted regexes miss. Silently accepting this produces a false-
  // clean [OK] for a file the validator never actually inspected, so
  // we throw to route the file to `parseErrors` → FAIL.
  //
  // IMPORTANT: we deliberately do NOT throw on files that merely lack
  // a `dependencies` declaration (tool-only configs like `[tool.black]`,
  // `[project]` metadata blocks with only `name`/`version`/`authors`,
  // hatch/uv/maturin configs without PEP 621 deps, etc.). Those produce
  // an empty DepMap as the correct, intended result.
  const declaresDependencies = /(?:^|\n)\s*dependencies\s*=/.test(raw);
  if (
    declaresDependencies &&
    Object.keys(out).length === 0 &&
    skipped.length === 0 &&
    dropped.length === 0
  ) {
    throw new Error(
      `pyproject.toml produced empty DepMap — a 'dependencies = …' key is declared but the regex parser could not extract any entries (likely malformed TOML or unsupported form).`,
    );
  }

  return { deps: out, skipped, dropped };
}

/**
 * Thin compatibility wrapper: returns a DepMap for callers that do not
 * care about skipped-dep diagnostics. Internally delegates to the
 * detailed form.
 *
 * NOTE: Like `parseRequirementsTxt`, this wrapper THROWS if the
 * underlying detailed parse produces any `skipped[]` or `dropped[]`
 * entries, so that silent data loss cannot occur via the wrapper path.
 * Callers that may legitimately encounter skipped/dropped entries MUST
 * call `parsePyprojectTomlDetailed` directly.
 *
 * @throws Error on fs.readFileSync failure, or on the specific narrow
 *         malformation: a top-level `[project] dependencies = [` array
 *         opened but never closed. This parser is NOT a general TOML
 *         validator — many other forms of malformed TOML will produce
 *         an empty DepMap rather than an exception.
 * @throws Error when the file contains skipped or dropped entries
 *         (use parsePyprojectTomlDetailed instead).
 */
function parsePyprojectToml(file: string): DepMap {
  const detailed = parsePyprojectTomlDetailed(file);
  if (detailed.skipped.length > 0 || detailed.dropped.length > 0) {
    throw new Error(
      `parsePyprojectToml: ${file} produced ${detailed.skipped.length} skipped and ` +
        `${detailed.dropped.length} dropped entries; use parsePyprojectTomlDetailed ` +
        `to access them instead of silently discarding.`,
    );
  }
  return detailed.deps;
}

// ---------------------------------------------------------------------------
// Find Dojo-side dependency files for a given example directory.
// ---------------------------------------------------------------------------

/**
 * Shape returned by `collectDepsFromDir` — used for both the Dojo side
 * (examples/integrations/<source>) and the showcase side
 * (showcase/packages/<slug>). Both sides walk the same
 * DEP_FILE_CANDIDATES list; the structure of the result is identical.
 *
 * `DojoDepSources` and `ShowcaseDepSources` are exported as aliases for
 * call-site readability, but they are structurally the same type and
 * callers can freely pass one where the other is expected.
 */
export interface DepSources {
  // All absolute paths to dependency files that contributed deps.
  files: string[];
  // Invariant: there is no merged `deps` field. Callers that need a
  // cross-ecosystem view must compose it explicitly at the call site
  // (e.g. `{ ...pythonDeps, ...jsDeps }`) and pick a precedence that
  // matches their ecosystem. The comparator in `validateAll` reads
  // `jsDeps` and `pythonDeps` directly.
  //
  // JS deps only (from package.json files). Kept separate from
  // pythonDeps because npm names are case-sensitive and hyphen-
  // sensitive; applying PEP 503 canonicalization would merge distinct
  // npm packages. Keeping JS and Python in separate maps also
  // prevents a cross-ecosystem name collision (e.g. `openai` present
  // in both `package.json` and `requirements.txt`) from erasing one
  // side's spec in the comparator.
  jsDeps: DepMap;
  // Python deps only (from requirements.txt / pyproject.toml).
  // Subject to PEP 503 canonicalization (case-insensitive, with `-`,
  // `_`, `.` treated as equivalent).
  pythonDeps: DepMap;
  // Non-fatal parse errors accumulated during collection. Caller should
  // surface these rather than silently emit [OK].
  // `infra: true` means the error is a permissions/filesystem problem
  // (EACCES/ENOTDIR/EIO/…) rather than a content-parse failure. The
  // caller (validateAll) uses this to route infra errors through
  // UnreadableInputError → EXIT_UNREADABLE (3) instead of landing them
  // in report.fail as EXIT_DRIFT (1).
  parseErrors: Array<{ file: string; message: string; infra?: boolean }>;
  // Count of files this collector attempted to read — used to
  // distinguish "no files found" from "all files parse-errored".
  filesAttempted: number;
  // Dep diagnostics forwarded from parsers (git-only Poetry deps,
  // unparseable requirements lines).
  skipped: Array<{ file: string; name: string; reason: string }>;
  dropped: Array<{ file: string; line: string }>;
}
// Named aliases for call-site readability. Structurally identical to
// `DepSources`.
export type DojoDepSources = DepSources;

// Common candidate list for dep file discovery. Order IS precedence:
// earlier entries are walked first, and because `collectDepsFromDir`
// applies first-writer-wins at the file level, the earlier file's spec
// for a shared dep name beats any later file's spec for the same name.
//
// Explicit precedence order (most-specific → least-specific):
//   1. apps/agent/*   — agent-scope manifests win over anything else
//   2. agent/*        — short-form `agent/` variant
//   3. apps/web/*     — showcase packages that only ship a web app
//   4. apps/app/*     — starter layouts using `apps/app/`
//   5. <root>/*       — catch-all fallback
const DEP_FILE_CANDIDATES = [
  "apps/agent/package.json",
  "apps/agent/pyproject.toml",
  "apps/agent/requirements.txt",
  "agent/package.json",
  "agent/pyproject.toml",
  "agent/requirements.txt",
  "apps/web/package.json",
  "apps/web/pyproject.toml",
  "apps/web/requirements.txt",
  "apps/app/package.json",
  "apps/app/pyproject.toml",
  "apps/app/requirements.txt",
  // Root-level files fill in anything not declared above.
  "package.json",
  "requirements.txt",
  "pyproject.toml",
];

function isPythonManifest(abs: string): boolean {
  return abs.endsWith("requirements.txt") || abs.endsWith("pyproject.toml");
}

/**
 * Common collector used by both Dojo-side and showcase-side. Walks
 * DEP_FILE_CANDIDATES in order, applying first-writer-wins at the file
 * level. Parse errors are accumulated rather than thrown so one bad
 * sibling doesn't abort the whole run.
 *
 * @throws Error on an unrecognized dep file path. This should be
 *         unreachable because DEP_FILE_CANDIDATES is a closed list; the
 *         throw exists to catch programmer error if someone adds a new
 *         file to DEP_FILE_CANDIDATES without wiring up a parser here.
 */
function collectDepsFromDir(rootDir: string): DepSources {
  const result: DepSources = {
    files: [],
    jsDeps: {},
    pythonDeps: {},
    parseErrors: [],
    filesAttempted: 0,
    skipped: [],
    dropped: [],
  };
  for (const rel of DEP_FILE_CANDIDATES) {
    const abs = path.join(rootDir, rel);
    // Prefer fs.statSync so an EACCES (unreadable) candidate is
    // distinguished from ENOENT (not present). `fs.existsSync` returns
    // false in both cases, which silently ignores broken permissions
    // — a missing framework dep file would then never be flagged.
    try {
      fs.statSync(abs);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      // A falsy throw (`throw null`, `throw undefined`, `throw ""`) carries
      // zero diagnostic info. Do not collapse into the ENOENT branch —
      // treat as unreadable so the caller routes through
      // UnreadableInputError → EXIT_UNREADABLE (3). Collapsing a falsy
      // throw into "candidate absent" would hide fs-layer failures and
      // produce a false green. Log a stderr breadcrumb AND classify as
      // infra so operators see what actually went wrong.
      if (!err) {
        console.error(
          `[validate-pins] statSync on ${abs} threw a falsy value (${String(e)}); treating as unreadable input`,
        );
        result.parseErrors.push({
          file: abs,
          message: `stat failed with falsy throw: ${String(e)}`,
          infra: true,
        });
        continue;
      }
      if (err.code === "ENOENT") continue;
      // EACCES / EIO / ELOOP / etc. — the candidate is "probably
      // there" but we can't read it. Surface as a parse error so the
      // caller emits a FAIL rather than silently passing over it.
      result.parseErrors.push({
        file: abs,
        message: `stat failed (${err.code ?? "unknown"}): ${err.message ?? String(e)}`,
        infra: true,
      });
      continue;
    }
    // Determine which parser to use BEFORE the try block so that an
    // unrecognized extension is treated as a programmer bug (throws out
    // of this function) rather than silently absorbed as a "successful
    // parse of empty deps". This is a closed-list guarantee: every
    // entry in DEP_FILE_CANDIDATES must have a parser here.
    let parser: "package.json" | "requirements.txt" | "pyproject.toml";
    if (abs.endsWith("package.json")) {
      parser = "package.json";
    } else if (abs.endsWith("requirements.txt")) {
      parser = "requirements.txt";
    } else if (abs.endsWith("pyproject.toml")) {
      parser = "pyproject.toml";
    } else {
      throw new Error(
        `collectDepsFromDir: no parser for dep file ${abs}. DEP_FILE_CANDIDATES and parser dispatch are out of sync.`,
      );
    }
    result.filesAttempted += 1;
    let parsed: DepMap = {};
    let skipped: Array<{ name: string; reason: string }> = [];
    let dropped: string[] = [];
    try {
      if (parser === "package.json") {
        parsed = parsePackageJson(abs);
      } else if (parser === "requirements.txt") {
        const detailed = parseRequirementsTxtDetailed(abs);
        parsed = detailed.deps;
        skipped = detailed.skipped;
        dropped = detailed.dropped;
      } else {
        const detailed = parsePyprojectTomlDetailed(abs);
        parsed = detailed.deps;
        skipped = detailed.skipped;
        dropped = detailed.dropped;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Record only — a single downstream [FAIL] line per parse error is
      // emitted by validateAll with slug context. Immediate
      // console.error here would cause duplicate output.
      //
      // Detect infra errno codes bubbling up from readFileSync (which is
      // called unguarded inside parsePackageJson / parseRequirementsTxt /
      // parsePyprojectToml). Without this classification an EACCES on
      // the content-only read would be treated as a parse error →
      // report.fail → EXIT_DRIFT (1), but the correct routing is
      // UnreadableInputError → EXIT_UNREADABLE (3). The stat guard
      // above only catches errno at stat time; TOCTOU or a 0000-mode
      // file on a readable parent (owner can chmod but not read the
      // file content, e.g. group read on a file you don't own) slips
      // past stat and errors on read instead.
      const errno = (e as NodeJS.ErrnoException | undefined)?.code;
      const isInfra =
        errno === "EACCES" ||
        errno === "EIO" ||
        errno === "ENOTDIR" ||
        errno === "ELOOP" ||
        errno === "EPERM";
      result.parseErrors.push({
        file: abs,
        message: msg,
        ...(isInfra ? { infra: true } : {}),
      });
      continue;
    }
    result.files.push(abs);
    for (const s of skipped) {
      result.skipped.push({ file: abs, name: s.name, reason: s.reason });
    }
    for (const d of dropped) {
      result.dropped.push({ file: abs, line: d });
    }
    const fromPython = isPythonManifest(abs);
    for (const [name, spec] of Object.entries(parsed)) {
      // First-writer-wins: agent-side files (walked first) take precedence
      // over root files. This matches the intent documented above.
      // Track JS vs Python in separate maps at parse time so a
      // cross-ecosystem name collision (e.g. `openai` on both sides)
      // cannot obliterate one side's spec. A shared map would require
      // deriving JS deps via `diffMaps(deps, pythonDeps)`, which drops
      // the JS dep ENTIRELY whenever its name also appears in
      // `pythonDeps` — unacceptable because both sides must be
      // compared independently.
      if (fromPython) {
        if (!(name in result.pythonDeps)) {
          result.pythonDeps[name] = spec;
        }
      } else {
        if (!(name in result.jsDeps)) {
          result.jsDeps[name] = spec;
        }
      }
    }
  }
  return result;
}

// The Dojo examples have varied layouts. We walk app-specific paths FIRST
// so that their specs take precedence over the root package.json, which
// often pins older / generic versions. This implements first-writer-wins
// at the file level: the first file that declares a dep wins.
function collectDojoDeps(exampleDir: string): DojoDepSources {
  return collectDepsFromDir(exampleDir);
}

// ---------------------------------------------------------------------------
// Showcase-side dep collection
// ---------------------------------------------------------------------------

// Structurally identical to `DepSources` — kept as a named alias for
// readability at call sites so the showcase vs dojo side remains
// textually distinct.
export type ShowcaseDepSources = DepSources;

function collectShowcaseDeps(packageDir: string): ShowcaseDepSources {
  return collectDepsFromDir(packageDir);
}

/**
 * Build a canonicalized lookup for a DepMap. Keeps the original name for
 * error messages but keys by canonical name so `foo_bar` and `foo-bar`
 * collide.
 *
 * When two entries canonicalize to the same key with DIFFERENT specs
 * (e.g. `langgraph_checkpoint==1.0.0` alongside
 * `langgraph-checkpoint==2.0.0` in the same requirements.txt) the
 * first-writer's entry is retained for comparison and a warning is
 * surfaced so operators see the conflict rather than silently losing
 * one of the pins. Same-spec collisions are considered redundant and
 * dropped silently.
 */
interface CanonicalizeWarning {
  key: string;
  firstName: string;
  firstSpec: string;
  dupName: string;
  dupSpec: string;
}
function canonicalizeDepMap(
  deps: DepMap,
  isPython: boolean,
): {
  out: Record<string, { name: string; spec: string }>;
  warnings: CanonicalizeWarning[];
} {
  const out: Record<string, { name: string; spec: string }> = {};
  const warnings: CanonicalizeWarning[] = [];
  for (const [name, spec] of Object.entries(deps)) {
    const key = isPython ? canonicalizePythonName(name) : name;
    // First-writer-wins within this function too (keep name as it was
    // originally declared). If a later entry collides on the canonical
    // key with a DIFFERENT spec, surface it as a warning — a silent
    // drop would hide a real drift signal (two entries for the same
    // distribution, both pinned, to different versions).
    const prior = out[key];
    if (prior === undefined) {
      out[key] = { name, spec };
      continue;
    }
    if (prior.spec !== spec) {
      warnings.push({
        key,
        firstName: prior.name,
        firstSpec: prior.spec,
        dupName: name,
        dupSpec: spec,
      });
    }
  }
  return { out, warnings };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// The four buckets are appended-to only while building the report in
// validateAll(); nothing should mutate them once they're returned to
// the printer. Marking them readonly string[] prevents drive-by mutation
// at read sites without paying the cost of a full PackageIssue tagged
// union + renderer refactor (deferred — the buckets are stringly-typed
// but that is a self-contained simplification rather than a correctness
// issue today). The mutation sites inside validateAll type as
// `string[]` via the inner `ReportBuilder` so .push() still works.
interface Report {
  readonly fail: readonly string[];
  readonly warn: readonly string[];
  readonly skip: readonly string[];
  readonly ok: readonly string[];
}
// Internal mutable shape used only while building the Report.
// Narrowed to `Report` (readonly) on return.
interface ReportBuilder {
  fail: string[];
  warn: string[];
  skip: string[];
  ok: string[];
}

function validateAll(): Report {
  const report: ReportBuilder = { fail: [], warn: [], skip: [], ok: [] };
  // Compute paths ONCE per run. `paths()` re-validates the
  // VALIDATE_PINS_REPO_ROOT env var every call, so invoking it per
  // slug turns every iteration into an fs.existsSync stat that has
  // already been performed.
  const resolvedPaths = paths();
  const { PACKAGES_DIR, EXAMPLES_DIR, REPO_ROOT } = resolvedPaths;

  // Missing packages dir must not produce a silent pass. If the validator
  // can't see any packages, it has nothing to check, which is almost
  // certainly a path misconfiguration. Route this as EXIT_UNREADABLE (3)
  // so it's classed with other repo-structure problems rather than with
  // real drift findings — mixing the two buckets makes CI triage harder.
  //
  // Use `fs.statSync` + catch-ENOENT rather than `fs.existsSync` so a
  // permission error (EACCES) is not silently collapsed into "not
  // present" and the packages dir not being a directory (i.e. it's a
  // file) is caught before readdirSync throws a less-obvious error.
  let packagesStat: fs.Stats;
  try {
    packagesStat = fs.statSync(PACKAGES_DIR);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code === "ENOENT") {
      throw new UnreadableInputError(
        `Packages dir not found at ${PACKAGES_DIR}`,
      );
    }
    // EACCES / ENOTDIR / EIO / etc. — packages dir exists but is
    // unreadable by this process. Route through UnreadableInputError
    // so the top-level catch maps this to EXIT_UNREADABLE (3)
    // rather than collapsing to EXIT_DRIFT (1) via report.fail.
    const msg = err && err.message ? err.message : String(e);
    throw new UnreadableInputError(
      `Packages dir stat failed (${err?.code ?? "unknown"}): ${PACKAGES_DIR}: ${msg}`,
    );
  }
  if (!packagesStat.isDirectory()) {
    throw new UnreadableInputError(
      `Packages dir is not a directory: ${PACKAGES_DIR}`,
    );
  }

  // readdirSync can fail independently of the statSync above (TOCTOU:
  // perms or mount state can change between the two calls, and EIO /
  // ENOTDIR / EACCES are all observable here). Without this wrapper the
  // error propagates to the top-level catch as a generic Error and is
  // misrouted to EXIT_INTERNAL (2). We convert infra-class errno codes
  // into UnreadableInputError so they route to EXIT_UNREADABLE (3),
  // preserving the same taxonomy as the statSync branch above.
  let slugs: string[];
  try {
    slugs = fs
      .readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const code = err?.code ?? "unknown";
    const msg = err?.message ?? String(e);
    // All readdir failures here are infra-class (we already passed the
    // stat + isDirectory guard above, so the dir did exist and was a
    // directory). Route to EXIT_UNREADABLE (3) so CI distinguishes
    // perms/mount state from a validator crash.
    throw new UnreadableInputError(
      `Packages dir readdir failed (${code}): ${PACKAGES_DIR}: ${msg}`,
    );
  }

  // Empty packages dir is the same class of error as missing — the
  // validator produced no results, so we fail loudly rather than exit 0.
  // Class this as EXIT_UNREADABLE (3): it's a repo-structure /
  // configuration problem (wrong VALIDATE_PINS_REPO_ROOT, bad checkout),
  // not actual pin drift. Keeping it out of report.fail preserves the
  // contract that EXIT_DRIFT (1) means "real drift findings".
  if (slugs.length === 0) {
    throw new UnreadableInputError(
      `No showcase packages discovered under ${PACKAGES_DIR} — is VALIDATE_PINS_REPO_ROOT pointing at the right tree?`,
    );
  }

  // Accumulates the first infra-class parseError observed during the
  // slug loop. We deliberately do NOT throw mid-loop — doing so would
  // orphan the report entries for preceding slugs AND the remaining
  // content parseErrors for the current slug, which hides real drift
  // behind a single infra misconfig. Throw at the end instead, with
  // the partial report attached so the top-level catch can print it.
  let pendingInfraError: UnreadableInputError | undefined;

  for (const slug of slugs) {
    const pkgDir = path.join(PACKAGES_DIR, slug);

    // resolveExampleDirDetailed can throw UnreadableInputError when its
    // internal existsAsDir stat fails with EACCES/ENOTDIR/ELOOP/EIO/…
    // on a candidate examples dir. An unguarded throw here escapes the
    // slug loop and orphans every report entry accumulated for preceding
    // slugs — the same orphan bug the content-parseError branch below
    // was fixed for (R29-2 C1). Route this through the same
    // pendingInfraError accumulator so the loop continues, every other
    // slug still contributes to the report, and the end-of-loop rebuild
    // attaches partialReport so the top-level catch can print it.
    let resolved: ResolveResult;
    try {
      resolved = resolveExampleDirDetailed(slug, resolvedPaths);
    } catch (e) {
      if (!(e instanceof UnreadableInputError)) {
        // Non-infra throws are genuine bugs — let them bubble to
        // EXIT_INTERNAL (2) rather than silently swallowing.
        throw e;
      }
      if (pendingInfraError === undefined) {
        pendingInfraError = new UnreadableInputError(`${slug}: ${e.message}`);
      }
      // Leave a per-slug breadcrumb in report.fail so operators see
      // WHICH slug failed to resolve — a bare end-of-loop throw with
      // only the first infra error would otherwise hide subsequent
      // resolve-time infra errors entirely.
      report.fail.push(
        `[FAIL] ${slug}: unreadable example dir during resolve: ${e.message}`,
      );
      continue;
    }
    const exampleDir = resolved.exampleDir;

    if (exampleDir === null) {
      if (BORN_IN_SHOWCASE.has(slug)) {
        report.skip.push(`[SKIP] ${slug}: born-in-showcase (no Dojo example)`);
      } else if (resolved.missingFallbackTarget) {
        report.warn.push(
          `[WARN] ${slug}: FALLBACK_MAP target '${resolved.missingFallbackTarget}' does not exist`,
        );
      } else {
        report.warn.push(`[WARN] unmatched slug: ${slug}`);
      }
      continue;
    }

    // Even when we resolved successfully, surface any fallback miss so
    // operators know FALLBACK_MAP needs cleanup.
    if (resolved.missingFallbackTarget) {
      report.warn.push(
        `[WARN] ${slug}: FALLBACK_MAP target '${resolved.missingFallbackTarget}' does not exist (fell through to reverse/direct match)`,
      );
    }

    const showcase = collectShowcaseDeps(pkgDir);
    const dojo = collectDojoDeps(exampleDir);

    // Parse errors: surface as FAIL so the process exits non-zero. A
    // silent WARN lets broken manifests slip through CI with [OK].
    //
    // EXCEPTION: infra errors (stat EACCES/ENOTDIR/…) are NOT drift —
    // they are permissions/filesystem misconfig. Route them through
    // UnreadableInputError so the top-level catch maps to
    // EXIT_UNREADABLE (3) rather than report.fail → EXIT_DRIFT (1).
    //
    // CRITICAL: do NOT throw mid-loop here. Accumulate the first infra
    // error into `pendingInfraError` and let the slug loop finish so
    // every OTHER slug still contributes to the report. The top-level
    // catch will print the (partial) report before setting
    // EXIT_UNREADABLE, so operators see the full FAIL/WARN/SKIP for
    // every slug that was processed. Content-parse errors for THIS
    // slug's remaining files still land in report.fail below.
    for (const pe of [...showcase.parseErrors, ...dojo.parseErrors]) {
      if (pe.infra && pendingInfraError === undefined) {
        pendingInfraError = new UnreadableInputError(
          `${slug}: unreadable input at ${path.relative(REPO_ROOT, pe.file)}: ${pe.message}`,
        );
      }
    }
    // Skip content-parse fail emission for entries tagged as infra —
    // those are routed through pendingInfraError and the top-level
    // catch, not report.fail.
    for (const pe of showcase.parseErrors) {
      if (pe.infra) continue;
      report.fail.push(
        `[FAIL] ${slug}: parse error in ${path.relative(REPO_ROOT, pe.file)}: ${pe.message}`,
      );
    }
    for (const pe of dojo.parseErrors) {
      if (pe.infra) continue;
      report.fail.push(
        `[FAIL] ${slug}: parse error in ${path.relative(REPO_ROOT, pe.file)}: ${pe.message}`,
      );
    }
    // Pre-seed pkgHadViolation from parseErrors. Otherwise a slug with
    // a mix of valid + parse-errored files would have one or more
    // [FAIL] lines AND still receive an [OK] line at the end (because
    // `pkgHadViolation` was only set from the per-dep loop). A slug
    // must not appear in both report.ok and report.fail.
    let pkgHadParseError = false;
    if (showcase.parseErrors.length > 0 || dojo.parseErrors.length > 0) {
      pkgHadParseError = true;
    }

    // Skipped deps (e.g. Poetry git-only) — WARN only.
    for (const s of showcase.skipped) {
      report.warn.push(
        `[WARN] ${slug}: skipped ${s.name} in ${path.relative(REPO_ROOT, s.file)}: ${s.reason}`,
      );
    }
    for (const s of dojo.skipped) {
      report.warn.push(
        `[WARN] ${slug}: skipped ${s.name} in ${path.relative(REPO_ROOT, s.file)}: ${s.reason}`,
      );
    }
    // Dropped requirements.txt lines (unparseable but not fatal) — WARN.
    for (const d of showcase.dropped) {
      report.warn.push(
        `[WARN] ${slug}: dropped unparseable line '${d.line}' in ${path.relative(REPO_ROOT, d.file)}`,
      );
    }
    for (const d of dojo.dropped) {
      report.warn.push(
        `[WARN] ${slug}: dropped unparseable line '${d.line}' in ${path.relative(REPO_ROOT, d.file)}`,
      );
    }

    // Distinguish "genuinely no files" from "files existed but all
    // parse-errored". Only the former is a FAIL (unless the slug is
    // explicitly born-in-showcase with no examples counterpart, which
    // we already [SKIP]ed above); the latter already produced FAIL(s)
    // above and we must not ALSO emit anything because that
    // double-counts and muddles the signal.
    //
    // A showcase package with zero dep files is structurally wrong —
    // it cannot possibly demonstrate a framework integration because
    // it has no declared runtime dependencies. Emit [FAIL] (not
    // [WARN]) so CI catches it rather than silently marking the
    // package OK just because there was nothing to compare against.
    if (showcase.files.length === 0) {
      if (showcase.filesAttempted === 0) {
        report.fail.push(
          `[FAIL] ${slug}: no dependency files found in showcase package`,
        );
      }
      // else: all attempted files parse-errored; FAIL already emitted.
      continue;
    }
    if (dojo.files.length === 0) {
      if (dojo.filesAttempted === 0) {
        report.warn.push(
          `[WARN] ${slug}: no dependency files found in Dojo example ` +
            `(${path.relative(REPO_ROOT, exampleDir)})`,
        );
      }
      continue;
    }

    // JS deps must NOT be Python-canonicalized (npm names are
    // case-sensitive and hyphen-sensitive, so `@Foo/bar` and `@foo/bar`
    // are DIFFERENT packages). Build two separate lookups per side — a
    // Python lookup (canonicalized) and a JS lookup (raw names) — then
    // compare Python-to-Python and JS-to-JS.
    const showcasePythonCanonResult = canonicalizeDepMap(
      showcase.pythonDeps,
      /* isPython */ true,
    );
    const showcasePythonCanon = showcasePythonCanonResult.out;
    const dojoPythonCanonResult = canonicalizeDepMap(
      dojo.pythonDeps,
      /* isPython */ true,
    );
    const dojoPythonCanon = dojoPythonCanonResult.out;
    // Invariant: the comparator reads `jsDeps` and `pythonDeps` directly
    // from separate parse-time maps. This keeps JS and Python specs
    // intact even when the same dep name appears in both ecosystems in
    // the same tree (e.g. `openai` with a JS `4.0.0` pin alongside a
    // Python `==1.2.3` pin) — neither side should be erased by the
    // other during comparison.
    const showcaseJsRawResult = canonicalizeDepMap(
      showcase.jsDeps,
      /* isPython */ false,
    );
    const showcaseJsRaw = showcaseJsRawResult.out;
    const dojoJsRawResult = canonicalizeDepMap(
      dojo.jsDeps,
      /* isPython */ false,
    );
    const dojoJsRaw = dojoJsRawResult.out;

    // Surface canonical-key collisions with DIFFERENT specs as WARN so
    // operators see a real drift signal (two pinned entries for the same
    // distribution at different versions within a single file) rather
    // than silently losing one pin to first-writer-wins. Tagged with
    // the side (showcase vs Dojo) so the report is unambiguous.
    const emitCanonicalWarnings = (
      side: "showcase" | "Dojo",
      warns: CanonicalizeWarning[],
    ) => {
      for (const w of warns) {
        report.warn.push(
          `[WARN] ${slug}: ${side} has duplicate entries for canonical key '${w.key}' with different specs ` +
            `(${w.firstName}=${w.firstSpec || "(empty)"} vs ${w.dupName}=${w.dupSpec || "(empty)"})`,
        );
      }
    };
    emitCanonicalWarnings("showcase", showcasePythonCanonResult.warnings);
    emitCanonicalWarnings("Dojo", dojoPythonCanonResult.warnings);
    emitCanonicalWarnings("showcase", showcaseJsRawResult.warnings);
    emitCanonicalWarnings("Dojo", dojoJsRawResult.warnings);

    let pkgHadViolation = pkgHadParseError;

    // Iterate the union of keys per ecosystem so drift where a framework
    // is pinned on one side but missing on the other is also surfaced.
    // Python keys live in one namespace, JS keys in another, with no risk
    // of cross-ecosystem collision.
    const pythonKeys = Array.from(
      new Set<string>([
        ...Object.keys(showcasePythonCanon),
        ...Object.keys(dojoPythonCanon),
      ]),
    ).sort();
    const jsKeys = Array.from(
      new Set<string>([
        ...Object.keys(showcaseJsRaw),
        ...Object.keys(dojoJsRaw),
      ]),
    ).sort();

    const iterations: Array<{
      key: string;
      sc: { name: string; spec: string } | undefined;
      dj: { name: string; spec: string } | undefined;
      isPython: boolean;
    }> = [];
    for (const key of pythonKeys) {
      iterations.push({
        key,
        sc: showcasePythonCanon[key],
        dj: dojoPythonCanon[key],
        isPython: true,
      });
    }
    for (const key of jsKeys) {
      iterations.push({
        key,
        sc: showcaseJsRaw[key],
        dj: dojoJsRaw[key],
        isPython: false,
      });
    }

    for (const { sc, dj, isPython, key } of iterations) {
      const displayName = sc?.name ?? dj?.name ?? key;

      // Canonicalize the name before the framework-pattern test when we
      // are on the Python path so PEP 503 variants (mixed case,
      // hyphen/underscore/dot) are still recognized as framework deps.
      // For JS deps the raw name is correct (npm is case-sensitive).
      const detectionName = isPython
        ? canonicalizePythonName(displayName)
        : displayName;
      if (!isFrameworkDep(detectionName)) continue;

      if (sc && !dj) {
        // Showcase has a framework dep that's not in the Dojo example.
        // This is allowed (showcase may add frameworks not in the example),
        // but we still require it to be an exact pin.
        if (isWorkspaceRef(sc.spec)) {
          // Workspace refs have no pin semantics — skip, don't FAIL.
          report.skip.push(
            `[SKIP] ${slug}: ${displayName} workspace ref (${sc.spec})`,
          );
          continue;
        }
        if (!isExactSpec(sc.spec)) {
          report.fail.push(
            `[FAIL] ${slug}: ${displayName} is not an exact pin in showcase ` +
              `(${sc.spec || "(empty)"})`,
          );
          pkgHadViolation = true;
        }
        continue;
      }

      if (!sc && dj) {
        // Dojo pins a framework dep that's entirely missing in showcase.
        // Surface as FAIL (or WARN for workspace refs below) so the
        // missing dep is never silently dropped from the drift report.
        if (isWorkspaceRef(dj.spec)) {
          // Dojo uses a workspace ref but showcase has NO entry for this
          // dep at all. A workspace ref does not give us a version to
          // mirror, but it still tells us the framework is expected to
          // be present. Emit a WARN rather than a silent SKIP so CI
          // surfaces that showcase is missing the dep entirely.
          report.warn.push(
            `[WARN] ${slug}: ${displayName} absent in showcase; Dojo declares it as workspace ref (${dj.spec})`,
          );
          continue;
        }
        report.fail.push(
          `[FAIL] ${slug}: ${displayName} absent in showcase but Dojo pins ${dj.spec || "(empty)"}`,
        );
        pkgHadViolation = true;
        continue;
      }

      if (sc && dj) {
        const scSpec = sc.spec;
        const djSpec = dj.spec;

        // Workspace ref on either side: nothing to pin-check. Enrich
        // the SKIP message with the counterpart pin so operators
        // grepping the log for a dep see the concrete target version.
        // Both branches render the same shape —
        //   `<dep> <showcase-spec> (Dojo pins <dojo-spec>)`
        // — so downstream log consumers can parse the SKIP line
        // uniformly regardless of which side holds the workspace ref.
        if (isWorkspaceRef(scSpec) && !isWorkspaceRef(djSpec)) {
          report.skip.push(
            `[SKIP] ${slug}: ${displayName} ${scSpec || "(empty)"} (Dojo pins ${djSpec || "(empty)"})`,
          );
          continue;
        }
        if (isWorkspaceRef(scSpec) || isWorkspaceRef(djSpec)) {
          report.skip.push(
            `[SKIP] ${slug}: ${displayName} ${scSpec || "(empty)"} (Dojo pins ${djSpec || "(empty)"})`,
          );
          continue;
        }

        // Per INTEGRATION-CHECKLIST: both sides must be EXACT pins, and
        // they must match. `next`/`*`/`^1.0.0` on both sides is a FAIL.
        if (!isExactSpec(scSpec) || !isExactSpec(djSpec)) {
          report.fail.push(
            `[FAIL] ${slug}: ${displayName} non-exact spec (showcase=${scSpec || "(empty)"}, Dojo=${djSpec || "(empty)"})`,
          );
          pkgHadViolation = true;
          continue;
        }

        if (scSpec !== djSpec) {
          report.fail.push(
            `[FAIL] ${slug}: ${displayName} pinned to ${scSpec || "(empty)"}, ` +
              `Dojo has ${djSpec || "(empty)"}`,
          );
          pkgHadViolation = true;
        }
      }
    }

    if (!pkgHadViolation) {
      report.ok.push(
        `[OK] ${slug} (vs ${path.relative(EXAMPLES_DIR, exampleDir)})`,
      );
    }
  }

  // If an infra error was observed mid-loop, throw it NOW that the
  // slug loop has fully finished. Attach the partial report so the
  // top-level catch can print every FAIL/WARN/SKIP line for slugs
  // that completed, then exit 3 (EXIT_UNREADABLE). This preserves the
  // "infra error → exit 3" contract while no longer discarding drift
  // findings for unaffected slugs.
  if (pendingInfraError !== undefined) {
    // Rebuild a fresh UnreadableInputError carrying the final report
    // — the one we captured earlier was constructed before all slugs
    // had been processed, so its partialReport would be stale.
    throw new UnreadableInputError(pendingInfraError.message, report);
  }

  return report;
}

/**
 * Print a report. [OK] and [SKIP] go to stdout; [FAIL] and [WARN] go to
 * stderr per Unix convention so CI logs, grep `|`, and humans can
 * distinguish.
 */
function printReport(report: Report): void {
  for (const line of report.ok) console.log(line);
  for (const line of report.skip) console.log(line);
  for (const line of report.warn) console.error(line);
  for (const line of report.fail) console.error(line);

  const summary =
    `Summary: OK=${report.ok.length} ` +
    `SKIP=${report.skip.length} ` +
    `WARN=${report.warn.length} ` +
    `FAIL=${report.fail.length}`;
  // Summary to stdout — it's an informational line, not an error.
  console.log("");
  console.log(summary);
}

// Exit codes are set via `process.exitCode` rather than `process.exit(N)`
// so that stdout/stderr have time to drain before the process
// terminates. `process.exit` is synchronous and can truncate output —
// the hash-based ratchet in CI compares full summary/table output and a
// truncated line would silently change the hash. Mirrors the audit.ts
// pattern.
// Typed setter for `process.exitCode` — forces every exit-code
// assignment in this file through the closed `PinsExitCode` union, so
// a typo like `process.exitCode = 4` becomes a compile error.
function setExitCode(code: PinsExitCode): void {
  process.exitCode = code;
}

function main(): void {
  const report = validateAll();
  printReport(report);
  setExitCode(report.fail.length > 0 ? EXIT_DRIFT : EXIT_OK);
}

/**
 * Returns true iff `argv1` refers to the same file as `scriptPath`
 * (which should be the caller's `import.meta.url`-derived file path,
 * e.g. via `fileURLToPath(import.meta.url)`). Uses strict
 * resolve-then-equal instead of substring match, so paths that merely
 * contain "validate-pins" (test harnesses, worker processes) do NOT
 * trigger `main()` on import.
 *
 * On a `path.resolve` failure (bizarre non-string input) we log to
 * stderr and set `process.exitCode = 2` so the caller sees a non-zero
 * exit; we still return false so main() doesn't run. A bare `catch {}`
 * would silently skip main() AND exit 0, masking bugs.
 */
function isMainPath(argv1: string | undefined, scriptPath: string): boolean {
  if (!argv1) return false;
  try {
    return path.resolve(argv1) === path.resolve(scriptPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[isMainPath] path.resolve failed: ${msg}`);
    setExitCode(EXIT_INTERNAL);
    return false;
  }
}

// Only run main when invoked directly (not when imported for tests).
// Top-level try/catch distinguishes "pin drift" (exit 1, legitimate) from
// "validator crashed" (exit 2, needs investigation). validate-parity.ts
// shares the "top-level try/catch routes crashes to a distinct exit
// code" pattern, but its exit-code numbering differs — see the header
// docstring for details.
if (isMainPath(process.argv[1], __filename)) {
  try {
    main();
  } catch (e) {
    const msg = e instanceof Error ? e.stack || e.message : String(e);
    if (e instanceof UnreadableInputError) {
      // Print the partial report FIRST (if present) so operators see
      // FAIL/WARN/SKIP for every slug that was processed before the
      // infra error. Without this, a single infra error would orphan
      // all already-collected report entries and produce a bare error
      // line with no diagnostic context.
      if (e.partialReport) {
        printReport(e.partialReport);
      }
      console.error(`[UNREADABLE INPUT] validate-pins: ${msg}`);
      setExitCode(EXIT_UNREADABLE);
    } else {
      console.error(`[INTERNAL ERROR] validate-pins crashed: ${msg}`);
      setExitCode(EXIT_INTERNAL);
    }
  }
}

export {
  resolveExampleDir,
  resolveExampleDirDetailed,
  collectShowcaseDeps,
  collectDojoDeps,
  parsePackageJson,
  parseRequirementsLine,
  parseRequirementsTxt,
  parseRequirementsTxtDetailed,
  parsePyprojectToml,
  parsePyprojectTomlDetailed,
  canonicalizePythonName,
  isExactSpec,
  isFrameworkDep,
  isMainPath,
  validateAll,
  printReport,
  FALLBACK_MAP,
  BORN_IN_SHOWCASE,
};
