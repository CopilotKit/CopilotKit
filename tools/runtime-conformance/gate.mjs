import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Files under a skipped directory that still require the matrix: the matrix
 * workflow itself, and the owners of the gate.
 */
const REQUIRED_FILES = new Set([
  ".github/CODEOWNERS",
  ".github/workflows/intelligence-runtimes.yml",
]);

/**
 * File names that require the matrix in any directory, skipped or not. Every
 * matrix leg runs `pnpm install --frozen-lockfile`, which reads the manifest of
 * every workspace member (package.json, or package.yaml or package.json5), and
 * builds the Nx project graph, which reads every project.json in the
 * repository and the package.json of every workspace member. A dependency
 * added without a lockfile update, or a duplicate project name, fails every
 * leg even when the package itself is skipped.
 */
const REQUIRED_NAMES = new Set([
  "package.json",
  "package.json5",
  "package.yaml",
  "project.json",
]);

/**
 * Files that no matrix step reads: documentation, review and release bots,
 * and editor settings. `.nvmrc` is skipped because the workflow pins
 * `node-version: "22.x"`. `docs` is a symlink to showcase/shell-docs.
 */
export const SKIP_FILES = new Set([
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/config-allowlist.txt",
  ".github/zizmor.yml",
  ".coderabbit.yaml",
  ".dockerignore",
  ".kodiak.toml",
  ".mcp.json",
  ".nvmrc",
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "VERSIONING.md",
  "commitlint.config.js",
  "dangerfile.js",
  "deploy-starter.sh",
  "docs",
  "release.config.json",
  "renovate.json",
]);

/**
 * Directories that no matrix step reads. The skipped packages are outside the
 * transitive workspace dependency closure of what the matrix builds, tests,
 * and lints (@copilotkit/runtime, @copilotkit/core, runtime-conformance, and
 * the four native runtimes), and no file in that closure reads them by path.
 */
export const SKIP_DIRECTORIES = [
  ".claude",
  ".claude-plugin",
  ".cursor",
  ".github/ISSUE_TEMPLATE",
  ".github/scripts",
  ".github/workflows",
  ".superset",
  "assets",
  "codemods",
  "community",
  "dev-docs",
  "docs",
  "examples",
  "prds",
  "sdk-python",
  "showcase",
  "skills",
  "tasks",
  "tools/compatibility-monitor",
  "tools/intelligence-smoke",
  "tools/learned-skill-conformance",
  "packages/a2ui-renderer",
  "packages/agentcore-runner",
  "packages/angular",
  "packages/demo-agents",
  "packages/intelligence-adk-python",
  "packages/intelligence-agent-framework-dotnet",
  "packages/intelligence-delivery-python-core",
  "packages/intelligence-langgraph",
  "packages/intelligence-langgraph-python",
  "packages/intelligence-mastra",
  "packages/mcp-apps-renderer",
  "packages/react-core",
  "packages/react-native",
  "packages/react-textarea",
  "packages/react-ui",
  "packages/runtime-client-gql",
  "packages/sdk-js",
  "packages/sqlite-runner",
  "packages/tailwind-config",
  "packages/voice",
  "packages/vue",
  "packages/web-components",
  "packages/web-inspector",
];

/** Whether a changed path is known not to feed the conformance matrix. */
function skippable(path) {
  if (REQUIRED_FILES.has(path)) return false;
  if (REQUIRED_NAMES.has(path.slice(path.lastIndexOf("/") + 1))) return false;
  return (
    SKIP_FILES.has(path) ||
    SKIP_DIRECTORIES.some((dir) => path.startsWith(`${dir}/`))
  );
}

/**
 * Identify changes that can alter the runtime or its conformance contract.
 * This is a skip-list: a change is exempt only when every path is known to be
 * unrelated. Any other path, including a new package, directory, or root
 * file, requires the matrix, so a new build input cannot be missed.
 */
export function requiresConformance(paths) {
  return !paths.every(skippable);
}

/** Accept only a complete matrix or a confirmed unrelated change. */
export function gatePassed(scope, required, matrix) {
  return (
    scope === "success" &&
    ((required === "true" && matrix === "success") ||
      (required === "false" && matrix === "skipped"))
  );
}

/**
 * Variables that make git use a repository other than the one found from
 * `cwd`. This is the list from `git rev-parse --local-env-vars`. Git hooks and
 * wrappers can set some of them (for example GIT_DIR and GIT_INDEX_FILE), and
 * a scope computed in that other repository would be wrong.
 */
export const REPO_LOCAL_GIT_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/** Run git in the checkout at `cwd`, ignoring repo-locating variables. */
function git(args, options) {
  const env = { ...process.env };
  for (const name of REPO_LOCAL_GIT_VARS) delete env[name];
  return execFileSync("git", args, { ...options, env });
}

/**
 * Resolve a commit in the checkout. With --quiet, an absent commit exits 1
 * with no output and yields `{ failed: false }`; any other failure (git
 * missing, not a repository, dubious ownership) is reported on stderr and
 * yields `{ failed: true }`, so callers give that git error as the reason
 * for the fail-safe full run instead of claiming the commit is absent.
 * stdout is reserved for GITHUB_OUTPUT.
 */
function lookup(rev) {
  try {
    const sha = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { sha, failed: false };
  } catch (error) {
    const detail = (error.stderr || "").trim();
    if (error.status !== 1 || detail) {
      console.error(
        `Runtime scope: git rev-parse ${rev} failed: ${detail || error.message}`,
      );
      return { failed: true };
    }
    return { failed: false };
  }
}

/** Resolve a commit in the checkout, or undefined when it is unavailable. */
function commit(rev) {
  return lookup(rev).sha;
}

/**
 * Normalize a full SHA-1 (40) or SHA-256 (64) hex commit id, in any case, to
 * lowercase. An empty value is undefined; any other value is reported and is
 * undefined, so it never reaches git and can never be read as a flag.
 */
function commitId(label, value) {
  if (!value) return undefined;
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)) {
    console.error(
      `${label} ${JSON.stringify(value)} is not a commit id; running everything.`,
    );
    return undefined;
  }
  return value.toLowerCase();
}

/**
 * Choose the commit to diff HEAD against, or undefined to run everything.
 * A pull_request checkout is GitHub's merge commit onto the current base, so
 * its first parent is that base; `pull_request.base.sha` lags behind main.
 * That holds only when the second parent is the PR head (PR_HEAD_SHA): a
 * checkout of the head itself can also be a merge (main merged into the
 * branch), and its first parent would hide the PR's own changes.
 * merge_group and push pass their own base in BASE_SHA. The PR head and the
 * base are both validated by commitId, and any that is not a resolvable
 * commit runs everything rather than failing the gate.
 */
export function scopeBase(event, base, head) {
  if (event === "pull_request") {
    if (!head) {
      console.error("PR_HEAD_SHA is not set; running everything.");
      return undefined;
    }
    const id = commitId("PR head", head);
    if (!id) return undefined;
    const { sha: second, failed } = lookup("HEAD^2");
    if (!second) {
      if (!failed) {
        console.error("HEAD is not a merge commit; running everything.");
      }
      return undefined;
    }
    if (second !== id) {
      console.error(
        `HEAD^2 ${second} is not PR head ${id}; running everything.`,
      );
      return undefined;
    }
    return commit("HEAD^1");
  }
  const id = commitId("Base", base);
  if (!id) return undefined;
  const { sha: resolved, failed } = lookup(id);
  if (!resolved && !failed) {
    console.error(`Base ${id} not found; running everything.`);
  }
  return resolved;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "scope") {
    const event = process.env.GITHUB_EVENT_NAME || "(unset)";
    const base = scopeBase(
      process.env.GITHUB_EVENT_NAME,
      process.env.BASE_SHA,
      process.env.PR_HEAD_SHA,
    );
    if (!base) {
      console.error(
        `Runtime scope: event=${event}, no diff base; running full conformance.`,
      );
      console.log("required=true");
    } else {
      console.error(
        `Runtime scope: event=${event}, diffing ${base}..${commit("HEAD") ?? "HEAD"}`,
      );
      let paths;
      try {
        paths = git(
          ["diff", "--no-renames", "--name-only", "-z", base, "HEAD"],
          {
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
          },
        )
          .split("\0")
          .filter(Boolean);
      } catch (error) {
        // A base that resolves can still fail to diff (a tree missing from a
        // partial clone, a corrupt object). Run everything, as for no base.
        const detail = (error.stderr || "").trim();
        console.error(
          `Runtime scope: git diff ${base}..HEAD failed: ${detail || error.message}; running full conformance.`,
        );
      }
      console.log(`required=${paths ? requiresConformance(paths) : true}`);
    }
  } else if (process.argv[2] === "check") {
    const { SCOPE_RESULT, CONFORMANCE_REQUIRED, MATRIX_RESULT } = process.env;
    if (!gatePassed(SCOPE_RESULT, CONFORMANCE_REQUIRED, MATRIX_RESULT)) {
      console.error(
        `Conformance gate failed: scope=${SCOPE_RESULT}, required=${CONFORMANCE_REQUIRED}, matrix=${MATRIX_RESULT}`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        CONFORMANCE_REQUIRED === "true"
          ? "All runtime conformance jobs passed."
          : "No runtime changes require conformance.",
      );
    }
  } else {
    throw new Error("Expected scope or check command");
  }
}
