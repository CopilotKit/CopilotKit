/**
 * Workflow Starter-List Validator
 *
 * The starter slug list has two remaining literal copies that must stay
 * in sync with `showcase/starters/*` on disk:
 *   - showcase_deploy.yml workflow_dispatch.inputs.service.options
 *     (GH Actions requires literal dropdown options; evaluated pre-checkout)
 *   - showcase_deploy.yml ALL_SERVICES matrix (per-starter deploy metadata:
 *     railway_id, dockerfile, health_path — can't be filesystem-derived)
 *
 * showcase_smoke-monitor.yml enumerates starters from `showcase/starters/*`
 * at runtime (sparse checkout + bash glob), so drift there is impossible
 * and no parity check is needed.
 *
 * For every directory under `showcase/starters/` (excluding `template/`),
 * this script verifies that `starter-<slug>` appears in both deploy.yml
 * locations above. Missing entries are reported with explicit fix hints.
 *
 * Usage (from showcase/ or showcase/scripts/):
 *   pnpm exec tsx validate-workflow-starters.ts
 *   VALIDATE_WORKFLOW_STARTERS_REPO_ROOT=/tmp/fixture pnpm exec tsx validate-workflow-starters.ts
 *
 * Exit codes (aligned with the other validate-* scripts):
 *   0 — parity OK
 *   1 — drift detected (one or more starters missing from a workflow)
 *   3 — unreadable (workflow file or starters dir missing)
 *   4 — internal error
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ROOT = showcase/ (NOT the repo root). This script lives at
// showcase/scripts/validate-workflow-starters.ts.
// Resolve the repo root so we can find .github/workflows/ even when
// invoked from any cwd. Override via env var for tests / fixtures.
// VALIDATE_WORKFLOW_STARTERS_REPO_ROOT overrides both STARTERS_DIR (via
// showcase/) and DEPLOY_WORKFLOW (via .github/) so a single env var
// re-homes every filesystem read.
const REPO_ROOT =
  process.env.VALIDATE_WORKFLOW_STARTERS_REPO_ROOT ??
  path.resolve(__dirname, "..", "..");
const SHOWCASE_ROOT = path.join(REPO_ROOT, "showcase");

const STARTERS_DIR = path.join(SHOWCASE_ROOT, "starters");
const DEPLOY_WORKFLOW = path.join(
  REPO_ROOT,
  ".github/workflows/showcase_deploy.yml",
);

// Directories under showcase/starters/ that are NOT starter services
// (skeletons, scaffolding, docs). Add new non-service siblings here.
// Keep in sync with `.github/workflows/showcase_smoke-monitor.yml` —
// the drift detector applies the same exclusion at enumeration time.
const EXCLUDED_DIRS = new Set(["template"]);

const EXIT_OK = 0 as const;
const EXIT_DRIFT = 1 as const;
const EXIT_UNREADABLE = 3 as const;
const EXIT_INTERNAL = 4 as const;

interface MissingEntry {
  readonly slug: string;
  readonly missingFrom: readonly string[];
}

/**
 * Enumerate the set of starter slugs on disk. Each entry is the bare
 * directory name (NOT prefixed with `starter-`) so callers can compose
 * the workflow-registered name themselves.
 */
export function listStarterSlugs(startersDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(startersDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `Cannot read starters directory ${startersDir}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !EXCLUDED_DIRS.has(name))
    .sort();
}

/**
 * Read a file and return its text. Throws with the source path on
 * failure so operators don't have to hunt for which file was missing.
 */
function readTextFile(absPath: string): string {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read ${absPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Parse a workflow YAML string. Thrown errors carry the underlying
 * parser message so CI logs identify the exact cause.
 */
function parseWorkflowYaml(deployYaml: string): unknown {
  try {
    return parseYaml(deployYaml);
  } catch (err) {
    throw new Error(
      `Cannot parse showcase_deploy.yml as YAML: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Navigate parsed YAML to `on.workflow_dispatch.inputs.service.options`
 * and return the options array (as strings) or null if any hop is absent
 * or mistyped. We accept either `on` or `true` at the top level because
 * the YAML spec bool-coerces bare `on:` keys — the `yaml` package (like
 * github's own parser) parses `on: { ... }` as key `true`. Real-world
 * workflow files hit this in the wild.
 */
function getWorkflowDispatchOptions(parsed: unknown): string[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  // `on:` gets YAML 1.1 bool-coerced to `true` by the `yaml` package.
  // GitHub Actions' own parser treats the key as the literal string "on"
  // because the workflow schema pre-binds it, but at the library level we
  // have to look both places.
  const onNode = (root["on"] ?? root[true as unknown as string]) as
    | Record<string, unknown>
    | undefined;
  if (!onNode || typeof onNode !== "object") return null;
  const dispatch = onNode["workflow_dispatch"];
  if (!dispatch || typeof dispatch !== "object") return null;
  const inputs = (dispatch as Record<string, unknown>)["inputs"];
  if (!inputs || typeof inputs !== "object") return null;
  const service = (inputs as Record<string, unknown>)["service"];
  if (!service || typeof service !== "object") return null;
  const options = (service as Record<string, unknown>)["options"];
  if (!Array.isArray(options)) return null;
  // options may contain non-string literals in a malformed workflow —
  // coerce to string defensively so includes() is well-defined.
  return options.map((v) => String(v));
}

/**
 * Locate the shell step that builds ALL_SERVICES and return its run
 * script body so we can extract the embedded JSON matrix. The matrix
 * itself lives inside a bash heredoc-style single-quoted variable, so
 * it is NOT a YAML sub-structure — we navigate to the step via YAML,
 * then the JSON block is lifted out of the run body textually.
 */
function getDetectChangesRunBody(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const jobs = root["jobs"];
  if (!jobs || typeof jobs !== "object") return null;
  const detect = (jobs as Record<string, unknown>)["detect-changes"];
  if (!detect || typeof detect !== "object") return null;
  const steps = (detect as Record<string, unknown>)["steps"];
  if (!Array.isArray(steps)) return null;
  // Find any step whose run body references ALL_SERVICES — this is the
  // step we care about. Keyed on the variable name rather than the step
  // `name:` so renaming the step doesn't break validation.
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const run = (step as Record<string, unknown>)["run"];
    if (typeof run !== "string") continue;
    if (run.includes("ALL_SERVICES")) return run;
  }
  return null;
}

/**
 * Extract every `dispatch_name` value from the embedded ALL_SERVICES
 * JSON array inside a run body. Regex scan because the JSON is
 * interpolated inside a shell heredoc and can contain `${{ ... }}`
 * Actions expressions that make JSON.parse unsafe — but the
 * `"dispatch_name":"<value>"` shape is unambiguous.
 */
function extractDispatchNames(runBody: string): string[] {
  const names: string[] = [];
  const re = /"dispatch_name"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(runBody)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * YAML-aware presence check for workflow_dispatch options. Parses the
 * workflow document and navigates to `on.workflow_dispatch.inputs.
 * service.options`, then tests for exact membership. Immune to
 * reformat / reorder / comment churn that would have defeated the
 * previous regex-based implementation. Word-boundary semantics are
 * preserved by `Array#includes`: "starter-ag2" is distinct from
 * "starter-ag2-extended" at the array level.
 */
export function isSlugInWorkflowDispatch(
  deployYaml: string,
  registeredName: string,
): boolean {
  const parsed = parseWorkflowYaml(deployYaml);
  const options = getWorkflowDispatchOptions(parsed);
  if (options === null) return false;
  return options.includes(registeredName);
}

/**
 * YAML-aware presence check for the ALL_SERVICES matrix. Parses the
 * workflow, locates the `detect-changes` job's step that defines
 * ALL_SERVICES, and extracts every `dispatch_name` from the embedded
 * JSON via a targeted regex (full JSON.parse is unsafe because the
 * matrix interpolates ${{ github.sha }} and similar expressions at
 * workflow-execution time). Membership is then checked by equality.
 */
export function isSlugInDeployMatrix(
  deployYaml: string,
  registeredName: string,
): boolean {
  const parsed = parseWorkflowYaml(deployYaml);
  const runBody = getDetectChangesRunBody(parsed);
  if (runBody === null) return false;
  return extractDispatchNames(runBody).includes(registeredName);
}

/**
 * Main entry point. Returns an exit code — the CLI wrapper below calls
 * process.exit with the return value. Kept pure to make testing easy.
 */
export function runValidation(): number {
  let slugs: string[];
  try {
    slugs = listStarterSlugs(STARTERS_DIR);
  } catch (err) {
    console.error(
      `[validate-workflow-starters] ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return EXIT_UNREADABLE;
  }

  if (slugs.length === 0) {
    console.error(
      `[validate-workflow-starters] No starter directories found under ${STARTERS_DIR} ` +
        `(excluding ${[...EXCLUDED_DIRS].join(", ")}). Refusing to pass trivially.`,
    );
    return EXIT_UNREADABLE;
  }

  let deployYaml: string;
  try {
    deployYaml = readTextFile(DEPLOY_WORKFLOW);
  } catch (err) {
    console.error(
      `[validate-workflow-starters] ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return EXIT_UNREADABLE;
  }

  const missing: MissingEntry[] = [];
  for (const slug of slugs) {
    const registered = `starter-${slug}`;
    const missingFrom: string[] = [];

    if (!isSlugInWorkflowDispatch(deployYaml, registered)) {
      missingFrom.push(
        `showcase_deploy.yml workflow_dispatch.inputs.service.options`,
      );
    }
    if (!isSlugInDeployMatrix(deployYaml, registered)) {
      missingFrom.push(`showcase_deploy.yml ALL_SERVICES matrix`);
    }

    if (missingFrom.length > 0) {
      missing.push({ slug: registered, missingFrom });
    }
  }

  if (missing.length === 0) {
    console.log(
      `[validate-workflow-starters] OK: all ${slugs.length} starter(s) registered across workflows`,
    );
    return EXIT_OK;
  }

  console.error(
    `[validate-workflow-starters] FAIL: ${missing.length} starter(s) missing workflow registration:`,
  );
  for (const entry of missing) {
    console.error(`  - ${entry.slug}`);
    for (const src of entry.missingFrom) {
      console.error(`      missing from: ${src}`);
    }
  }
  console.error(
    `\nHint: add the slug to each location listed above. See existing starter entries for the shape.`,
  );
  return EXIT_DRIFT;
}

// CLI entry point — skipped when this module is imported by tests.
// `fileURLToPath(import.meta.url)` is the canonical path form on Node 20+;
// compare directly with `process.argv[1]` which is the script path.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(runValidation());
  } catch (err) {
    console.error(
      `[validate-workflow-starters] internal error: ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }`,
    );
    process.exit(EXIT_INTERNAL);
  }
}
