import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Run the mock LLM as `pnpm aimock` from the repo root. That root script is
 * the single place that names the bin, and it resolves the version pinned by
 * `showcase/scripts` without touching the registry.
 *
 * Never npx. BOTH names are taken on npm by unrelated projects, checked
 * against the live registry:
 *
 *   aimock@0.2.9   "An OpenAI api simulator for developing and testing"
 *   llmock@3.3.6   "A configurable mock LLM API server for testing and development"
 *
 * `@copilotkit/aimock` is not a root-workspace importer, so `npx aimock` from
 * the repo root downloads the first of those. The second is the more
 * dangerous of the two, because a mock LLM server is plausible enough to look
 * like it is working.
 *
 * The package also ships two bins with different CLIs, measured from `--help`
 * on the pinned 1.37.4:
 *
 *   llmock  -f/--fixtures, --validate-on-load, --record, --watch, ...
 *   aimock  -c/--config (REQUIRED), -p/--port, -h/--host — and no --fixtures
 *
 * So `aimock --fixtures ...` is wrong even with the scoped package.
 */
const FORBIDDEN = [
  // Any npx invocation of either bin name, scoped or bare.
  /\bnpx\s+(?:-\S+\s+)*(?:@copilotkit\/)?(?:ai|ll)mock\b/,
  // The config-only `aimock` bin handed `--fixtures`, which it does not accept.
  // The lookbehind spares `pnpm aimock`, the sanctioned form, which routes to
  // the `llmock` bin. Requiring a flag straight after the name spares
  // `showcase/aimock` used as a fixtures *path*.
  /(?<!pnpm )\baimock\s+-[^\n]*--fixtures\b/,
];

const SCANNED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".sh",
  ".py",
  ".md",
  ".yml",
  ".yaml",
];

/**
 * Enumerate from git rather than from a glob of the working tree.
 *
 * Two reasons. Committed content is what this check is about, so an untracked
 * scratch file a sibling test wrote must not fail the build. And this suite
 * runs `fileParallelism` with `pool: "forks"`, so sibling tests are creating
 * and deleting paths under `showcase/` while this one scans — a glob listed a
 * file that was gone by the time it was read.
 */
function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "showcase/"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter(Boolean)
    .filter(
      (rel) =>
        SCANNED_EXTENSIONS.includes(path.extname(rel)) ||
        path.basename(rel) === ".env.example",
    );
}

describe("aimock is invoked through the workspace bin, never bare npx", () => {
  const files = trackedFiles();

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no forbidden aimock invocation", () => {
    const hits: string[] = [];
    for (const rel of files) {
      // This test states the patterns, so it necessarily contains them.
      if (rel.endsWith("__tests__/aimock-bin-invocation.test.ts")) continue;
      let contents: string;
      try {
        contents = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      } catch {
        continue; // a sibling test removed it mid-scan
      }
      const lines = contents.split("\n");
      lines.forEach((line, index) => {
        if (FORBIDDEN.some((pattern) => pattern.test(line))) {
          hits.push(`${rel}:${index + 1}  ${line.trim()}`);
        }
      });
    }
    expect(hits.sort()).toEqual([]);
  });
});
