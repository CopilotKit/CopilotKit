import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("Railway GraphQL host unification", () => {
  it("no source file references backboard.railway.com (must be .app)", () => {
    // grep across showcase/ and .github/workflows/. Use -F (literal) so
    // the dot in the pattern is not regex-interpreted. The test file
    // itself contains the forbidden literal; exclude it via --glob.
    // Also exclude two files that legitimately reference the deprecated
    // host in documentation/negative-assertion form (no functional use):
    //   - railway-graphql.ts JSDoc explains the deprecated .com endpoint
    //   - railway-graphql.test.ts asserts the endpoint is NOT .com
    let out = "";
    try {
      out = execSync(
        `git -C ${REPO_ROOT} grep -nF "backboard.railway.com" -- showcase ':(exclude)showcase/scripts/lib/__tests__/railway-graphql.scan.test.ts' ':(exclude)showcase/scripts/lib/railway-graphql.ts' ':(exclude)showcase/scripts/lib/__tests__/railway-graphql.test.ts' .github/workflows`,
        { encoding: "utf-8" },
      );
    } catch {
      // git grep exits 1 when no matches — that's the success case.
      out = "";
    }
    expect(out).toBe("");
  });
});
