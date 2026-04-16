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
 *      specifier strings match EXACTLY.
 *   4. Emit `[FAIL] <pkg>: <dep> pinned to X, Dojo has Y` for drift.
 *
 * Usage:
 *   npx tsx showcase/scripts/validate-pins.ts
 *
 * Exit codes:
 *   0 — no FAIL violations (WARN/SKIP are non-fatal)
 *   1 — one or more FAIL violations (pin drift detected)
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

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXAMPLES_DIR = path.join(REPO_ROOT, "examples", "integrations");
const PACKAGES_DIR = path.join(REPO_ROOT, "showcase", "packages");

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
function buildReverseMap(): Record<string, string[]> {
  const reverse: Record<string, string[]> = {};
  for (const [example, slug] of Object.entries(SLUG_MAP)) {
    if (!reverse[slug]) reverse[slug] = [];
    reverse[slug].push(example);
  }
  return reverse;
}

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

function resolveExampleDir(showcaseSlug: string): string | null {
  if (BORN_IN_SHOWCASE.has(showcaseSlug)) return null;

  // 1. Explicit fallback wins (documents SLUG_MAP staleness).
  const fallback = FALLBACK_MAP[showcaseSlug];
  if (fallback) {
    const dir = path.join(EXAMPLES_DIR, fallback);
    return fs.existsSync(dir) ? dir : null;
  }

  // 2. Reverse-map lookup from SLUG_MAP.
  const reverse = buildReverseMap();
  const candidates = reverse[showcaseSlug] || [];
  for (const cand of candidates) {
    const dir = path.join(EXAMPLES_DIR, cand);
    if (fs.existsSync(dir)) return dir;
  }

  // 3. Direct name match (common case).
  const direct = path.join(EXAMPLES_DIR, showcaseSlug);
  if (fs.existsSync(direct)) return direct;

  return null;
}

// ---------------------------------------------------------------------------
// Dependency extraction
// ---------------------------------------------------------------------------

// Heuristic: what counts as an agent framework / SDK that must be pinned.
// Applied by prefix or substring. These are compared against dependency
// NAMES only; versions are compared via exact string match per the
// INTEGRATION-CHECKLIST rule.
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
  // LlamaIndex
  /^llama-index$/,
  /^llama-index-/,
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
];

function isFrameworkDep(name: string): boolean {
  return FRAMEWORK_PATTERNS.some((re) => re.test(name));
}

interface DepMap {
  [name: string]: string; // name -> raw version specifier string
}

function parsePackageJson(file: string): DepMap {
  const raw = fs.readFileSync(file, "utf-8");
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
  };
  // Only `dependencies` — dev deps are explicitly out of scope per spec.
  return { ...(pkg.dependencies || {}) };
}

// Parse a requirements.txt line. Strip comments, extras, env markers.
// Returns [name, versionSpec] or null if unparseable.
function parseRequirementsLine(line: string): [string, string] | null {
  const stripped = line.replace(/#.*$/, "").trim();
  if (!stripped) return null;
  // Editable installs / URLs — not supported.
  if (/^-e\b/.test(stripped) || /^(https?|git\+)/.test(stripped)) return null;

  // Split on environment marker (;) and take the LHS.
  const lhs = stripped.split(";")[0].trim();

  // Match: name [extras] version-spec
  // name characters: letters, digits, -, _, .
  const match = lhs.match(
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

// Extremely small pyproject.toml reader: we only need the top-level
// [project].dependencies array. Avoids adding a TOML dependency.
function parsePyprojectToml(file: string): DepMap {
  const raw = fs.readFileSync(file, "utf-8");
  const out: DepMap = {};

  // Find the [project] section and its dependencies array.
  const projectMatch = raw.match(/\n?\[project\][\s\S]*?(?=\n\[|$)/);
  if (!projectMatch) return out;
  const section = projectMatch[0];

  const depsMatch = section.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (!depsMatch) return out;

  const body = depsMatch[1];
  // Extract all quoted strings.
  const quoteRe = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(body))) {
    const entry = m[1] ?? m[2] ?? "";
    const parsed = parseRequirementsLine(entry);
    if (parsed) out[parsed[0]] = parsed[1];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Find Dojo-side dependency files for a given example directory.
// ---------------------------------------------------------------------------

interface DojoDepSources {
  // All absolute paths to Dojo-side dependency files that contributed deps.
  files: string[];
  // Merged dep map (later files take precedence if names collide).
  deps: DepMap;
}

// The Dojo examples have varied layouts. Common locations:
//   <example>/package.json                     (web frontend)
//   <example>/apps/web/package.json            (workspaces)
//   <example>/apps/agent/package.json          (TS agent)
//   <example>/apps/agent/pyproject.toml        (Python agent)
//   <example>/agent/package.json
//   <example>/agent/pyproject.toml
//   <example>/agent/requirements.txt
//   <example>/requirements.txt
function collectDojoDeps(exampleDir: string): DojoDepSources {
  const candidates = [
    "package.json",
    "apps/web/package.json",
    "apps/app/package.json",
    "apps/agent/package.json",
    "apps/agent/pyproject.toml",
    "apps/agent/requirements.txt",
    "agent/package.json",
    "agent/pyproject.toml",
    "agent/requirements.txt",
    "requirements.txt",
    "pyproject.toml",
  ];
  const result: DojoDepSources = { files: [], deps: {} };
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
      // Ignore parse errors for individual files; they'll surface as
      // missing deps. Don't crash the whole validator.
      continue;
    }
    result.files.push(abs);
    for (const [name, spec] of Object.entries(parsed)) {
      // First writer wins so that e.g. root package.json (agent deps) does
      // not clobber apps/agent/package.json. We walk in order above and
      // skip if already set.
      if (!(name in result.deps)) result.deps[name] = spec;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Showcase-side dep collection
// ---------------------------------------------------------------------------

interface ShowcaseDepSources {
  files: string[];
  deps: DepMap;
}

function collectShowcaseDeps(packageDir: string): ShowcaseDepSources {
  const result: ShowcaseDepSources = { files: [], deps: {} };
  const candidates = ["package.json", "requirements.txt", "pyproject.toml"];
  for (const rel of candidates) {
    const abs = path.join(packageDir, rel);
    if (!fs.existsSync(abs)) continue;
    let parsed: DepMap = {};
    try {
      if (rel === "package.json") parsed = parsePackageJson(abs);
      else if (rel === "requirements.txt") parsed = parseRequirementsTxt(abs);
      else if (rel === "pyproject.toml") parsed = parsePyprojectToml(abs);
    } catch {
      continue;
    }
    result.files.push(abs);
    for (const [name, spec] of Object.entries(parsed)) {
      if (!(name in result.deps)) result.deps[name] = spec;
    }
  }
  return result;
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

  if (!fs.existsSync(PACKAGES_DIR)) {
    report.warn.push(`Packages dir not found: ${PACKAGES_DIR}`);
    return report;
  }

  const slugs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const slug of slugs) {
    const pkgDir = path.join(PACKAGES_DIR, slug);
    const exampleDir = resolveExampleDir(slug);

    if (exampleDir === null) {
      if (BORN_IN_SHOWCASE.has(slug)) {
        report.skip.push(`[SKIP] ${slug}: born-in-showcase (no Dojo example)`);
      } else {
        report.warn.push(`[WARN] unmatched slug: ${slug}`);
      }
      continue;
    }

    const showcase = collectShowcaseDeps(pkgDir);
    const dojo = collectDojoDeps(exampleDir);

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

    // Compare: for each framework dep present in BOTH maps, spec strings
    // must match EXACTLY.
    let pkgHadViolation = false;
    const sortedNames = Object.keys(showcase.deps).sort();
    for (const name of sortedNames) {
      if (!isFrameworkDep(name)) continue;
      if (!(name in dojo.deps)) continue;

      const showcaseSpec = showcase.deps[name];
      const dojoSpec = dojo.deps[name];
      if (showcaseSpec !== dojoSpec) {
        report.fail.push(
          `[FAIL] ${slug}: ${name} pinned to ${showcaseSpec || "(empty)"}, ` +
            `Dojo has ${dojoSpec || "(empty)"}`,
        );
        pkgHadViolation = true;
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

function main(): void {
  const report = validateAll();

  // Print OK/SKIP/WARN/FAIL in a stable order for grep-ability.
  for (const line of report.ok) console.log(line);
  for (const line of report.skip) console.log(line);
  for (const line of report.warn) console.log(line);
  for (const line of report.fail) console.log(line);

  console.log("");
  console.log(
    `Summary: OK=${report.ok.length} ` +
      `SKIP=${report.skip.length} ` +
      `WARN=${report.warn.length} ` +
      `FAIL=${report.fail.length}`,
  );

  process.exit(report.fail.length > 0 ? 1 : 0);
}

// Only run main when invoked directly (not when imported for tests).
const isMain = process.argv[1]?.includes("validate-pins");
if (isMain) main();

export {
  resolveExampleDir,
  collectShowcaseDeps,
  collectDojoDeps,
  parseRequirementsLine,
  parsePyprojectToml,
  isFrameworkDep,
  validateAll,
  FALLBACK_MAP,
  BORN_IN_SHOWCASE,
};
