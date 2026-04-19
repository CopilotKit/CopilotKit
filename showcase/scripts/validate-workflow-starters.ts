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
 * Regex-based presence checks — not a full YAML parse. The workflow
 * files are authoritative for their own syntax (github actions parses
 * them), so we only need to confirm the literal slug appears in the
 * expected region(s). We use word-boundary (`\b`) anchoring so
 * `starter-ag2` can't accidentally match `starter-ag2-extended`.
 */
export function isSlugInWorkflowDispatch(
  deployYaml: string,
  registeredName: string,
): boolean {
  // Match `- starter-<slug>` as a standalone list entry under
  // `options:`. We locate the options block first so a stray mention
  // elsewhere (comments, ALL_SERVICES) can't spoof the check.
  const optionsMatch = deployYaml.match(
    /inputs:\s*\n\s+service:[\s\S]*?options:\s*\n([\s\S]*?)(?:^\S|\n\s*\w+:\s*\n\s{6,}\w+:|\nconcurrency:)/m,
  );
  if (!optionsMatch) return false;
  const optionsBlock = optionsMatch[1];
  const entryPattern = new RegExp(
    `^\\s*-\\s+${escapeRegex(registeredName)}\\s*$`,
    "m",
  );
  return entryPattern.test(optionsBlock);
}

export function isSlugInDeployMatrix(
  deployYaml: string,
  registeredName: string,
): boolean {
  // ALL_SERVICES entries look like:
  //   {"dispatch_name":"starter-foo","filter_key":"starter_foo",...}
  const pattern = new RegExp(
    `"dispatch_name"\\s*:\\s*"${escapeRegex(registeredName)}"`,
  );
  return pattern.test(deployYaml);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
// `import.meta.url` is a file:// URL; `process.argv[1]` is a plain path.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === process.argv[1]
) {
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
