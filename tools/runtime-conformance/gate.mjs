import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Identify changes that can alter the runtime or its conformance contract. */
export function requiresConformance(paths) {
  return paths.some((path) =>
    /^(?:packages\/(?:runtime(?:-(?:python|go|ruby|dotnet))?|core|shared|aimock)\/|tools\/runtime-conformance\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|nx\.json$|tsconfig[^/]*\.json$|\.github\/(?:CODEOWNERS$|workflows\/intelligence-runtimes\.yml$))/.test(
      path,
    ),
  );
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
