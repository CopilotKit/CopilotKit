import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ROOT, loadConfig } from "../lib/config.js";
import { CHANGELOG_PATHS } from "../lib/changelog.js";
import type { ReleaseScope } from "../lib/config.js";

/**
 * Each release lane keeps one CHANGELOG.md, and that file is how the notes
 * travel: `write-changelog.ts` records a section on the release branch,
 * create-pull-request commits it, and `extract-release-notes.ts` reads it back
 * in the publish job as the GitHub Release body.
 *
 * Both failure modes this guards were live. The file being gitignored is what
 * silently dropped notes for every release before this lane existed. The file
 * not existing at all is what a new scope in release.config.json would produce.
 */
const scopes = Object.keys(loadConfig().scopes) as ReleaseScope[];

const git = (args: string[]) =>
  spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });

describe.each(scopes)("%s lane changelog", (scope) => {
  const relative = CHANGELOG_PATHS[scope];

  it("exists", () => {
    expect(
      fs.existsSync(path.join(ROOT, relative)),
      `${scope} has no changelog at ${relative}. Add the file, or fix ` +
        `CHANGELOG_PATHS in scripts/release/lib/changelog.ts.`,
    ).toBe(true);
  });

  it("is not gitignored", () => {
    // check-ignore exits 0 when the path IS ignored, 1 when it is not.
    //
    // `--no-index` is load-bearing: without it, check-ignore reports nothing
    // for a path that is already tracked, so this assertion passes against an
    // ignore rule that would still strand the NEXT lane's file. Verified by
    // adding a lane changelog back to .gitignore — the flagless form stayed
    // green, this one fails.
    const result = git(["check-ignore", "--no-index", relative]);
    expect(
      result.status,
      `${relative} is gitignored (matched by: ${result.stdout.trim()}), so the ` +
        `release PR cannot commit it and the publish job will fall back to a ` +
        `bodyless "Release <tag>" GitHub Release.`,
    ).not.toBe(0);
  });

  it("is tracked by git", () => {
    expect(
      git(["ls-files", "--error-unmatch", relative]).status,
      `${relative} is untracked. It must be committed for the publish job to ` +
        `read this release's notes back out of it.`,
    ).toBe(0);
  });
});

describe("the repo has one changelog per lane and no others", () => {
  it("tracks exactly the lane changelogs", () => {
    // 29 stale files predated this: changesets-era per-package changelogs that
    // stopped at 1.55.2 (angular's still claimed 1.54.3 while the lane shipped
    // 0.5.0). Two changelogs that disagree is worse than one, so the set is
    // pinned rather than merely seeded.
    const tracked = git(["ls-files"])
      .stdout.split("\n")
      .filter((file) => /(^|\/)changelog\.(md|txt)$/i.test(file))
      .sort();

    expect(
      tracked,
      `Changelogs outside the release lanes drift and contradict the real ` +
        `versions. Record changes in the lane's file instead, or add the new ` +
        `lane to CHANGELOG_PATHS.`,
    ).toEqual(Object.values(CHANGELOG_PATHS).sort());
  });
});
