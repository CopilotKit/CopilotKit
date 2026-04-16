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
 *
 * Output routing:
 *   - [OK] and [SKIP] lines go to stdout.
 *   - [FAIL] and [WARN] lines go to stderr (per Unix convention).
 *
 * --- NOTE: SLUG_MAP staleness ---
 *
 * The `SLUG_MAP` exported from `migrate-integration-examples.ts` is KNOWN
 * STALE with respect to the current set of directory names under
 * `showcase/packages/`. The following showcase slugs are not covered by the
 * reverse map (showcase slug -> examples/integrations dir) and require a
 * supplemental mapping maintained inside this script:
 *
 *   showcase slug          SLUG_MAP says          actual examples/ dir
 *   -------------          ---------------        ----------------------
 *   crewai-crews           (maps to "crewai")     crewai-crews
 *   ms-agent-dotnet        "maf-dotnet"           ms-agent-framework-dotnet
 *   ms-agent-python        "maf-python"           ms-agent-framework-python
 *   pydantic-ai            "pydanticai"           pydantic-ai
 *   strands                "aws-strands"          strands-python
 *
 * Additionally, several showcase packages are "born-in-showcase" — they
 * have no Dojo counterpart and are skipped with [SKIP]:
 *
 *   ag2, claude-sdk-python, claude-sdk-typescript, langroid, spring-ai
 *
 * If SLUG_MAP is refreshed, remove the fallbacks from `FALLBACK_MAP` below
 * and the warning comments above. Staleness is tracked in the "Full Action
 * Inventory" doc.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// We intentionally do NOT import from migrate-integration-examples.ts:
// SLUG_MAP is not exported, and mirroring it locally lets us document
// staleness via FALLBACK_MAP without coupling to the migration script's
// internals.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// REPO_ROOT resolution allows tests to override via env var.
function computeRepoRoot(): string {
  const override = process.env.VALIDATE_PINS_REPO_ROOT;
  if (override) return override;
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

// Mirror of SLUG_MAP (examples dir -> showcase slug) from
// migrate-integration-examples.ts. Duplicated here because that file does
// not export it; keeping the duplicate is the lesser evil versus importing
// internal state and silently inheriting staleness.
const SLUG_MAP: Record<string, string> = {
  "langgraph-python": "langgraph-python",
  "langgraph-js": "langgraph-typescript",
  "langgraph-fastapi": "langgraph-fastapi",
  mastra: "mastra",
  "crewai-crews": "crewai",
  "crewai-flows": "crewai",
  "pydantic-ai": "pydanticai",
  agno: "agno",
  llamaindex: "llamaindex",
  adk: "google-adk",
  "ms-agent-framework-dotnet": "maf-dotnet",
  "ms-agent-framework-python": "maf-python",
  "strands-python": "aws-strands",
  "agent-spec": "agent-spec-langgraph",
  "a2a-a2ui": "a2a",
  "a2a-middleware": "a2a",
  "mcp-apps": "mcp-apps",
};

// Reverse (showcase slug -> candidate examples dirs) built from SLUG_MAP.
// Precomputed at module load (not per-call) for perf and correctness.
const REVERSE_MAP: Record<string, string[]> = (() => {
  const reverse: Record<string, string[]> = {};
  for (const [example, slug] of Object.entries(SLUG_MAP)) {
    if (!reverse[slug]) reverse[slug] = [];
    reverse[slug].push(example);
  }
  return reverse;
})();

// Known stale mappings: current showcase slug -> examples/integrations dir.
// Documented above; these entries override / supplement the reverse map.
const FALLBACK_MAP: Record<string, string> = {
  "crewai-crews": "crewai-crews",
  "ms-agent-dotnet": "ms-agent-framework-dotnet",
  "ms-agent-python": "ms-agent-framework-python",
  "pydantic-ai": "pydantic-ai",
  strands: "strands-python",
};

// Packages intentionally without a Dojo counterpart.
const BORN_IN_SHOWCASE = new Set<string>([
  "ag2",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "langroid",
  "spring-ai",
]);

export interface ResolveResult {
  exampleDir: string | null;
  // If a FALLBACK_MAP entry existed but pointed to a missing dir, the
  // caller should emit a distinct WARN with this path for diagnostics.
  missingFallbackTarget?: string;
}

function resolveExampleDirDetailed(showcaseSlug: string): ResolveResult {
  if (BORN_IN_SHOWCASE.has(showcaseSlug)) return { exampleDir: null };

  const { EXAMPLES_DIR } = paths();

  // 1. Explicit fallback wins (documents SLUG_MAP staleness), but fall
  // through to other strategies if the target dir does not exist.
  const fallback = FALLBACK_MAP[showcaseSlug];
  let missingFallbackTarget: string | undefined;
  if (fallback) {
    const dir = path.join(EXAMPLES_DIR, fallback);
    if (fs.existsSync(dir)) return { exampleDir: dir };
    missingFallbackTarget = path.relative(path.dirname(EXAMPLES_DIR), dir);
  }

  // 2. Reverse-map lookup from SLUG_MAP.
  const candidates = REVERSE_MAP[showcaseSlug] || [];
  for (const cand of candidates) {
    const dir = path.join(EXAMPLES_DIR, cand);
    if (fs.existsSync(dir)) return { exampleDir: dir, missingFallbackTarget };
  }

  // 3. Direct name match (common case).
  const direct = path.join(EXAMPLES_DIR, showcaseSlug);
  if (fs.existsSync(direct))
    return { exampleDir: direct, missingFallbackTarget };

  return { exampleDir: null, missingFallbackTarget };
}

function resolveExampleDir(showcaseSlug: string): string | null {
  return resolveExampleDirDetailed(showcaseSlug).exampleDir;
}

// ---------------------------------------------------------------------------
// Dependency extraction
// ---------------------------------------------------------------------------

// Heuristic: what counts as an agent framework / SDK that must be pinned.
// Applied by prefix or substring. These are compared against dependency
// NAMES only; versions are compared via exact string match per the
// INTEGRATION-CHECKLIST rule.
//
// Expected match set (non-exhaustive sanity list): @copilotkit/*, copilotkit,
// @ag-ui/*, ag-ui-*, ag_ui_*, @langchain/*, langchain, langchain-*,
// langgraph, langgraph-*, langsmith, @mastra/*, mastra, crewai, crewai-*,
// pydantic-ai, pydantic-ai-*, agno, llama-index, llama-index-*,
// llama_index, llama_index_*, llamaindex, google-adk, google-genai,
// strands-agents, strands-agents-*, agent-framework, agent-framework-*,
// @ai-sdk/*, ai, @hashbrownai/*, @anthropic-ai/*, anthropic, openai,
// ag2, langroid, spring-ai*, spring-ai-*.
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
  /^org\.springframework\.ai:/,
];

function isFrameworkDep(name: string): boolean {
  return FRAMEWORK_PATTERNS.some((re) => re.test(name));
}

export interface DepMap {
  [name: string]: string; // name -> raw version specifier string
}

function parsePackageJson(file: string): DepMap {
  const raw = fs.readFileSync(file, "utf-8");
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  // Merge dependencies, devDependencies, and peerDependencies. Frameworks
  // in JS apps often live in devDeps (e.g. Next.js starters), and pinning
  // rules apply to them all. On overlap, later spread wins: dev > peer >
  // runtime. That's fine because (a) the caller applies first-writer-wins
  // at the FILE level, and (b) in practice these rarely overlap within
  // one file.
  return {
    ...pkg.dependencies,
    ...pkg.peerDependencies,
    ...pkg.devDependencies,
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
 * Returns true if `spec` is an EXACT pin per the INTEGRATION-CHECKLIST rule.
 *
 * Accepts:
 *   - Bare semver-ish strings: "1.2.3", "0.2.14", "1.0.0-beta.1", "1.2.3.post1"
 *   - Python exact specs: "==1.2.3", "===1.2.3", "==0.2.14"
 *
 * Rejects:
 *   - Range operators: ^, ~, >=, <=, >, <, ~=, !=
 *   - Dist-tags / wildcards: "latest", "next", "*", "" (empty)
 *   - Workspace/monorepo refs: "workspace:*", "workspace:^", "file:"
 *   - URLs / git refs / paths
 */
function isExactSpec(spec: string): boolean {
  if (!spec) return false;
  const trimmed = spec.trim();
  if (!trimmed) return false;

  // Python == / === exact form.
  const pyMatch = trimmed.match(/^={2,3}\s*(\S+)$/);
  if (pyMatch) {
    return /^\d/.test(pyMatch[1]);
  }

  // Anything starting with a range operator is NOT exact.
  if (/^[\^~<>!]/.test(trimmed)) return false;
  if (/^(>=|<=|==|~=|!=)/.test(trimmed)) return false;

  // Wildcard, tags, workspace refs, URLs, paths.
  if (trimmed === "*" || trimmed === "x" || trimmed === "X") return false;
  if (/^[A-Za-z]/.test(trimmed)) {
    // Starts with a letter: dist-tag like "latest" or "next", or
    // "workspace:*", "file:...", "github:user/repo", etc.
    return false;
  }

  // Bare version must start with a digit and contain no ranges/spaces.
  if (!/^\d/.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return false;
  if (/[|]{1,2}/.test(trimmed)) return false; // "1.2.3 || 2.0.0"

  return true;
}

// Parse a requirements.txt line. Strip comments, extras, env markers,
// pip hash flags and index-url flags.
// Returns [name, versionSpec] or null if unparseable.
function parseRequirementsLine(line: string): [string, string] | null {
  // Strip trailing comments.
  const stripped = line.replace(/#.*$/, "").trim();
  if (!stripped) return null;
  // Editable installs / URLs — not supported.
  if (/^-e\b/.test(stripped) || /^(https?|git\+)/.test(stripped)) return null;

  // Split on environment marker (;) and take the LHS.
  const lhs = stripped.split(";")[0].trim();

  // Strip pip-install flags attached to a single line:
  //   `--hash=sha256:...`, `--index-url=...`, `--extra-index-url=...`
  // Also `--find-links=...`. These appear AFTER the spec.
  const flagsStripped = lhs
    .replace(/\s+--hash=\S+/g, "")
    .replace(/\s+--index-url=\S+/g, "")
    .replace(/\s+--extra-index-url=\S+/g, "")
    .replace(/\s+--find-links=\S+/g, "")
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

function parseRequirementsTxt(file: string): DepMap {
  const raw = fs.readFileSync(file, "utf-8");
  const out: DepMap = {};
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseRequirementsLine(line);
    if (parsed) out[parsed[0]] = parsed[1];
  }
  return out;
}

/**
 * Extremely small pyproject.toml reader. Handles:
 *
 *   - Top-level `[project]` dependencies array (PEP 621).
 *   - Poetry `[tool.poetry.dependencies]` table.
 *
 * We avoid adding a full TOML dependency by using targeted regexes. The
 * parser stops at the NEXT TOP-LEVEL table header (e.g. `[tool.foo]`) —
 * crucially NOT at dotted subtables like `[project.optional-dependencies]`,
 * which are children of `[project]`.
 */
function parsePyprojectToml(file: string): DepMap {
  const raw = fs.readFileSync(file, "utf-8");
  const out: DepMap = {};

  // --- PEP 621: [project] table ---
  // Find the [project] section body, stopping at the next TOP-LEVEL
  // header (i.e. `[something]` or `[something-without-dots]` at column 0).
  // Dotted subtables like `[project.optional-dependencies]` are NOT
  // top-level and should not end the section.
  const projectBodyRe =
    /(?:^|\n)\[project\][^\n]*\n([\s\S]*?)(?=\n\[[^.\]\n]+\]|\n*$)/;
  const projectMatch = raw.match(projectBodyRe);
  if (projectMatch) {
    const section = projectMatch[1];

    // Look for a dependencies = [...] assignment. Anchor so we don't match
    // `optional-dependencies = [...]` or other `*-dependencies = [...]`.
    // The key must start at a line boundary and be literally `dependencies`.
    const depsMatch = section.match(
      /(?:^|\n)dependencies\s*=\s*\[([\s\S]*?)\]/,
    );
    if (depsMatch) {
      const body = depsMatch[1];
      // Extract all quoted strings.
      const quoteRe = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
      let m: RegExpExecArray | null;
      while ((m = quoteRe.exec(body))) {
        const entry = m[1] ?? m[2] ?? "";
        const parsed = parseRequirementsLine(entry);
        if (parsed) out[parsed[0]] = parsed[1];
      }
    }
  }

  // --- Poetry: [tool.poetry.dependencies] table ---
  const poetryBodyRe =
    /(?:^|\n)\[tool\.poetry\.dependencies\][^\n]*\n([\s\S]*?)(?=\n\[|\n*$)/;
  const poetryMatch = raw.match(poetryBodyRe);
  if (poetryMatch) {
    const body = poetryMatch[1];
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
        // Inline table. Pull `version = "..."` out of it.
        const vm = value.match(/version\s*=\s*"([^"]*)"/);
        if (vm) spec = vm[1];
        else continue;
      } else if (value.startsWith('"') || value.startsWith("'")) {
        const q = value[0];
        const end = value.indexOf(q, 1);
        if (end > 0) spec = value.slice(1, end);
      } else {
        // Not a string — skip (booleans, numbers etc.)
        continue;
      }

      out[name] = spec;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Find Dojo-side dependency files for a given example directory.
// ---------------------------------------------------------------------------

export interface DojoDepSources {
  // All absolute paths to Dojo-side dependency files that contributed deps.
  files: string[];
  // Merged dep map. Order: app-specific files (apps/agent, agent/**) are
  // walked BEFORE root-level files so that on dep-name collision, the
  // agent-side spec wins (first-writer-wins).
  deps: DepMap;
  // Non-fatal parse errors accumulated during collection. Caller should
  // surface these rather than silently emit [OK].
  parseErrors: Array<{ file: string; message: string }>;
}

// The Dojo examples have varied layouts. We walk app-specific paths FIRST
// so that their specs take precedence over the root package.json, which
// often pins older / generic versions. This implements first-writer-wins
// at the file level: the first file that declares a dep wins.
function collectDojoDeps(exampleDir: string): DojoDepSources {
  const candidates = [
    // App-/agent-specific files come first so they win over root.
    "apps/agent/package.json",
    "apps/agent/pyproject.toml",
    "apps/agent/requirements.txt",
    "agent/package.json",
    "agent/pyproject.toml",
    "agent/requirements.txt",
    "apps/web/package.json",
    "apps/app/package.json",
    // Root-level files fill in anything not declared above.
    "package.json",
    "requirements.txt",
    "pyproject.toml",
  ];
  const result: DojoDepSources = { files: [], deps: {}, parseErrors: [] };
  for (const rel of candidates) {
    const abs = path.join(exampleDir, rel);
    if (!fs.existsSync(abs)) continue;
    let parsed: DepMap = {};
    try {
      if (abs.endsWith("package.json")) parsed = parsePackageJson(abs);
      else if (abs.endsWith("requirements.txt"))
        parsed = parseRequirementsTxt(abs);
      else if (abs.endsWith("pyproject.toml")) parsed = parsePyprojectToml(abs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Log to stderr so CI surfaces it, and record in result for callers.
      console.error(`[parse-error] ${abs}: ${msg}`);
      result.parseErrors.push({ file: abs, message: msg });
      continue;
    }
    result.files.push(abs);
    for (const [name, spec] of Object.entries(parsed)) {
      // First-writer-wins: agent-side files (walked first) take precedence
      // over root files. This matches the intent documented above.
      if (!(name in result.deps)) result.deps[name] = spec;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Showcase-side dep collection
// ---------------------------------------------------------------------------

export interface ShowcaseDepSources {
  files: string[];
  deps: DepMap;
  parseErrors: Array<{ file: string; message: string }>;
}

function collectShowcaseDeps(packageDir: string): ShowcaseDepSources {
  const result: ShowcaseDepSources = { files: [], deps: {}, parseErrors: [] };
  // Agent-side files first, then root (same first-writer-wins scheme as
  // collectDojoDeps).
  const candidates = [
    "apps/agent/package.json",
    "apps/agent/pyproject.toml",
    "apps/agent/requirements.txt",
    "agent/package.json",
    "agent/pyproject.toml",
    "agent/requirements.txt",
    "package.json",
    "requirements.txt",
    "pyproject.toml",
  ];
  for (const rel of candidates) {
    const abs = path.join(packageDir, rel);
    if (!fs.existsSync(abs)) continue;
    let parsed: DepMap = {};
    try {
      if (abs.endsWith("package.json")) parsed = parsePackageJson(abs);
      else if (abs.endsWith("requirements.txt"))
        parsed = parseRequirementsTxt(abs);
      else if (abs.endsWith("pyproject.toml")) parsed = parsePyprojectToml(abs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[parse-error] ${abs}: ${msg}`);
      result.parseErrors.push({ file: abs, message: msg });
      continue;
    }
    result.files.push(abs);
    for (const [name, spec] of Object.entries(parsed)) {
      if (!(name in result.deps)) result.deps[name] = spec;
    }
  }
  return result;
}

/**
 * Build a canonicalized lookup for a DepMap. Keeps the original name for
 * error messages but keys by canonical name so `foo_bar` and `foo-bar`
 * collide.
 */
function canonicalizeDepMap(
  deps: DepMap,
  isPython: boolean,
): Record<string, { name: string; spec: string }> {
  const out: Record<string, { name: string; spec: string }> = {};
  for (const [name, spec] of Object.entries(deps)) {
    const key = isPython ? canonicalizePythonName(name) : name;
    // First-writer-wins within this function too (keep name as it was
    // originally declared).
    if (!(key in out)) out[key] = { name, spec };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Report {
  fail: string[];
  warn: string[];
  skip: string[];
  ok: string[];
}

function validateAll(): Report {
  const report: Report = { fail: [], warn: [], skip: [], ok: [] };
  const { PACKAGES_DIR, EXAMPLES_DIR, REPO_ROOT } = paths();

  if (!fs.existsSync(PACKAGES_DIR)) {
    report.warn.push(`[WARN] Packages dir not found: ${PACKAGES_DIR}`);
    return report;
  }

  const slugs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const slug of slugs) {
    const pkgDir = path.join(PACKAGES_DIR, slug);
    const resolved = resolveExampleDirDetailed(slug);
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

    // Surface parse errors as WARN so they are not silently swallowed.
    for (const pe of showcase.parseErrors) {
      report.warn.push(
        `[WARN] ${slug}: parse error in ${path.relative(REPO_ROOT, pe.file)}: ${pe.message}`,
      );
    }
    for (const pe of dojo.parseErrors) {
      report.warn.push(
        `[WARN] ${slug}: parse error in ${path.relative(REPO_ROOT, pe.file)}: ${pe.message}`,
      );
    }

    if (showcase.files.length === 0) {
      report.warn.push(
        `[WARN] ${slug}: no dependency files found in showcase package`,
      );
      continue;
    }
    if (dojo.files.length === 0) {
      report.warn.push(
        `[WARN] ${slug}: no dependency files found in Dojo example ` +
          `(${path.relative(REPO_ROOT, exampleDir)})`,
      );
      continue;
    }

    // Build canonical lookups so that Python hyphen/underscore spellings
    // compare equal.
    const showcaseCanon = canonicalizeDepMap(
      showcase.deps,
      /* isPython */ true,
    );
    const dojoCanon = canonicalizeDepMap(dojo.deps, /* isPython */ true);

    let pkgHadViolation = false;

    // For each framework dep in EITHER side, compare. We iterate union so
    // that Dojo-pinned-but-absent-in-showcase drift is also surfaced.
    const allKeys = new Set<string>([
      ...Object.keys(showcaseCanon),
      ...Object.keys(dojoCanon),
    ]);
    const sortedKeys = Array.from(allKeys).sort();

    for (const key of sortedKeys) {
      const sc = showcaseCanon[key];
      const dj = dojoCanon[key];
      const displayName = sc?.name ?? dj?.name ?? key;

      // We only enforce framework deps. The canonical key may match for
      // non-framework libs, which we skip.
      if (!isFrameworkDep(displayName)) continue;

      if (sc && !dj) {
        // Showcase has a framework dep that's not in the Dojo example.
        // This is allowed (showcase may add frameworks not in the example),
        // but we still require it to be an exact pin.
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
        // Dojo pins a framework dep that's entirely missing in showcase —
        // silent drift that the old validator would miss.
        report.fail.push(
          `[FAIL] ${slug}: ${displayName} absent in showcase but Dojo pins ${dj.spec || "(empty)"}`,
        );
        pkgHadViolation = true;
        continue;
      }

      if (sc && dj) {
        const scSpec = sc.spec;
        const djSpec = dj.spec;

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

function main(): void {
  const report = validateAll();
  printReport(report);
  process.exit(report.fail.length > 0 ? 1 : 0);
}

/**
 * Returns true iff `argv1` refers to the same file as `scriptUrl` (which
 * should be the caller's `import.meta.url`-derived path). Uses strict
 * resolve-then-equal instead of substring match, so paths that merely
 * contain "validate-pins" (test harnesses, worker processes) do NOT
 * trigger `main()` on import.
 */
function isMainPath(argv1: string | undefined, scriptPath: string): boolean {
  if (!argv1) return false;
  try {
    return path.resolve(argv1) === path.resolve(scriptPath);
  } catch {
    return false;
  }
}

// Only run main when invoked directly (not when imported for tests).
if (isMainPath(process.argv[1], __filename)) main();

export {
  resolveExampleDir,
  resolveExampleDirDetailed,
  collectShowcaseDeps,
  collectDojoDeps,
  parsePackageJson,
  parseRequirementsLine,
  parsePyprojectToml,
  canonicalizePythonName,
  isExactSpec,
  isFrameworkDep,
  isMainPath,
  validateAll,
  printReport,
  FALLBACK_MAP,
  BORN_IN_SHOWCASE,
};
