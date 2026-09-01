import { spawnSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/config.js";

/**
 * `release-notes.md` is how the generated notes travel from the create-pr
 * workflow to the publish job: prepare-release writes it, create-pull-request
 * commits it onto the release branch, and publish-release reads it back as the
 * GitHub Release body.
 *
 * It was gitignored, so create-pull-request silently skipped it and every
 * release since the lane was built shipped the `Release <tag>` fallback body
 * instead of notes. An ignore rule is the one way to break this without
 * breaking any other test, hence this guard.
 */
describe("release-notes.md reaches the publish job", () => {
  it("is not gitignored", () => {
    const result = spawnSync("git", ["check-ignore", "release-notes.md"], {
      cwd: ROOT,
      encoding: "utf8",
    });

    // git check-ignore exits 0 when the path IS ignored, 1 when it is not.
    expect(
      result.status,
      `release-notes.md is gitignored (matched by: ${result.stdout.trim()}), so it ` +
        `cannot be committed to the release PR branch and the publish job will ` +
        `fall back to a bodyless "Release <tag>" GitHub Release.`,
    ).not.toBe(0);
  });

  it("is the path both halves of the lane agree on", () => {
    const prepare = path.join(ROOT, "scripts/release/prepare-release.ts");
    const publish = path.join(ROOT, ".github/workflows/publish-release.yml");
    const read = (p: string) =>
      spawnSync("cat", [p], { encoding: "utf8" }).stdout;

    expect(read(prepare)).toContain('"release-notes.md"');
    expect(read(publish)).toContain('"./release-notes.md"');
  });
});
