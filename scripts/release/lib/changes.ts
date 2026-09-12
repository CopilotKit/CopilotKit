import { spawnSync } from "child_process";
import path from "path";
import { ROOT } from "./config.js";
import type { ReleaseScope } from "./config.js";
import { getPackagesForScope } from "./versions.js";

function getReleaseTagPattern(scope: ReleaseScope): string {
  return scope === "monorepo" ? "v*" : `${scope}/v*`;
}

function isReleaseTag(scope: ReleaseScope, tag: string): boolean {
  const prefix = scope === "monorepo" ? "" : `${scope}/`;
  return (
    tag.startsWith(prefix) && /^v\d+\.\d+\.\d+$/.test(tag.slice(prefix.length))
  );
}

export function getLastReleaseTag(scope: ReleaseScope): string | null {
  const result = spawnSync(
    "git",
    ["tag", "--list", getReleaseTagPattern(scope), "--sort=-v:refname"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const tags = result.stdout.trim().split("\n").filter(Boolean);

  for (const tag of tags) {
    if (isReleaseTag(scope, tag)) {
      return tag;
    }
  }

  return null;
}

export interface Commit {
  hash: string;
  subject: string;
  body: string;
  /** PR number parsed from the merge subject, when the commit landed via a PR. */
  pr: number | null;
}

/**
 * Repo-relative directories whose history belongs to `scope`'s release notes.
 *
 * Scopes are independent release lanes over disjoint package sets, so a scope's
 * notes must never inherit another lane's commits. Without this filter the
 * angular lane rendered every commit since its tag — 159 of them for v0.5.0,
 * of which 4 were actually angular.
 */
export function getScopePathspecs(scope: ReleaseScope): string[] {
  return getPackagesForScope(scope).map(
    (p) => path.relative(ROOT, p.dir) || ".",
  );
}

/** Trailing `(#1234)` that a merge subject carries. */
const PR_SUFFIX = /\(#(\d+)\)\s*$/;

export function parsePrNumber(subject: string): number | null {
  const match = subject.match(PR_SUFFIX);
  return match ? Number(match[1]) : null;
}

const NOISE_TYPE = /^(?:test|ci|style)(?:\([^)]*\))?!?:/i;
const CHORE_TYPE = /^chore(?:\(([^)]*)\))?!?:/i;
const RELEASE_SUBJECT = /^chore(?:\([^)]*\))?!?: release\b/i;

/**
 * Whether a commit is real work that no consumer of the package would want to
 * read about in release notes.
 *
 * `chore(deps)` is deliberately NOT noise: a dependency bump is observable by
 * anyone installing the package. The release commit itself is noise — it is an
 * artifact of the release, not a change within it.
 */
export function isNoiseCommit(subject: string): boolean {
  if (RELEASE_SUBJECT.test(subject)) return true;
  if (NOISE_TYPE.test(subject)) return true;

  const chore = subject.match(CHORE_TYPE);
  if (chore) return (chore[1] ?? "").toLowerCase() !== "deps";

  return false;
}

export const GIT_LOG_FORMAT = "%H%x1f%s%x1f%b%x1e";

export function parseCommitLog(output: string): Commit[] {
  return output
    .split("\x1e")
    .map((record) => record.replace(/^\r?\n/, "").trimEnd())
    .filter(Boolean)
    .flatMap((record) => {
      const firstSeparator = record.indexOf("\x1f");
      const secondSeparator = record.indexOf("\x1f", firstSeparator + 1);

      if (firstSeparator === -1 || secondSeparator === -1) return [];

      const subject = record.slice(firstSeparator + 1, secondSeparator);

      return [
        {
          hash: record.slice(0, firstSeparator),
          subject,
          body: record.slice(secondSeparator + 1).trim(),
          pr: parsePrNumber(subject),
        },
      ];
    });
}

/**
 * A merge commit's own body is the PR description, which is usually where a
 * `BREAKING CHANGE:` footer lives — but not always. A footer written on a
 * branch commit reaches neither the merge subject nor the merge body, so
 * selecting mainline commits alone silently drops it (measured: 2 real notes
 * lost across v1.60.0..HEAD).
 *
 * Fold each merge's branch messages into its body so downstream extraction
 * sees the whole PR while the entry list stays one-per-PR. Non-merge commits
 * make the range invalid, which git reports as a non-zero exit — treated here
 * as "no branch commits" rather than an error.
 */
export function withBranchMessages(commit: Commit): Commit {
  const result = spawnSync(
    "git",
    ["log", `${commit.hash}^1..${commit.hash}^2`, "--format=%s%n%b"],
    { cwd: ROOT, encoding: "utf8" },
  );

  if (result.status !== 0) return commit;

  const branchMessages = (result.stdout ?? "").trim();
  if (!branchMessages) return commit;

  return {
    ...commit,
    body: [commit.body, branchMessages].filter(Boolean).join("\n\n"),
  };
}

/**
 * Mainline commits in `range` that touched `pathspecs`.
 *
 * `--first-parent` (not `--no-merges`) is what makes these read as PRs. This
 * repo merges PRs with a merge commit, so the merge is the unit of change and
 * is the only commit carrying the `(#1234)` reference; its branch commits are
 * intermediate steps. `--no-merges` inverted that — it dropped every PR
 * boundary and kept the work-in-progress.
 */
function getCommitsSince(
  lastTag: string | null,
  pathspecs: string[],
): Commit[] {
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const args = ["log", range, "--first-parent", `--format=${GIT_LOG_FORMAT}`];
  if (pathspecs.length > 0) args.push("--", ...pathspecs);

  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });

  return parseCommitLog(result.stdout).map(withBranchMessages);
}

export function getCommitsSinceLastRelease(scope: ReleaseScope): Commit[] {
  return getCommitsSince(getLastReleaseTag(scope), getScopePathspecs(scope));
}

export interface ChangesSummary {
  lastTag: string | null;
  commitCount: number;
  commits: Commit[];
  oneline: string;
}

export interface ChangesOptions {
  /** Overrides the scope's package directories. Primarily for tests. */
  pathspecs?: string[];
}

export function getChangesSummary(
  scope: ReleaseScope,
  options: ChangesOptions = {},
): ChangesSummary {
  const lastTag = getLastReleaseTag(scope);
  const pathspecs = options.pathspecs ?? getScopePathspecs(scope);
  const commits = getCommitsSince(lastTag, pathspecs).filter(
    (commit) => !isNoiseCommit(commit.subject),
  );

  return {
    lastTag,
    commitCount: commits.length,
    commits,
    oneline: commits.map((c) => `- ${c.subject}`).join("\n"),
  };
}
