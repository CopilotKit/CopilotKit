import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("Railway GraphQL host unification", () => {
  it("no source file references backboard.railway.com (must be .app)", () => {
    // grep across showcase/ and .github/workflows/. Use -F (literal) so
    // the dot in the pattern is not regex-interpreted. The test file
    // itself contains the forbidden literal; exclude it via git pathspec
    // `:(exclude)` magic. Also exclude two files that legitimately
    // reference the deprecated host in documentation/negative-assertion
    // form (no functional use):
    //   - railway-graphql.ts JSDoc explains the deprecated .com endpoint
    //   - railway-graphql.test.ts asserts the endpoint is NOT .com
    // Use --untracked so a newly-added (not-yet-committed) file that
    // reintroduces the forbidden host still trips the guard. Use
    // execFileSync with an args array so REPO_ROOT is not shell-parsed.
    let out = "";
    try {
      out = execFileSync(
        "git",
        [
          "-C",
          REPO_ROOT,
          "grep",
          "--untracked",
          "-nF",
          "backboard.railway.com",
          "--",
          "showcase",
          ":(exclude)showcase/scripts/lib/__tests__/railway-graphql.scan.test.ts",
          ":(exclude)showcase/scripts/lib/railway-graphql.ts",
          ":(exclude)showcase/scripts/lib/__tests__/railway-graphql.test.ts",
          ".github/workflows",
        ],
        { encoding: "utf-8" },
      );
    } catch (err) {
      // git grep exits 1 when no matches — that's the clean-miss success
      // case. Any other exit status (git missing, bad cwd, pathspec
      // syntax error, etc.) must fail loud rather than silently pass.
      const status = (err as { status?: number }).status;
      if (status === 1) {
        out = "";
      } else {
        throw err;
      }
    }
    expect(out).toBe("");
  });
});
