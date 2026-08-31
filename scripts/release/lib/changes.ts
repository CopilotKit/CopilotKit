import { spawnSync } from "child_process";
import { ROOT } from "./config.js";
import type { ReleaseScope } from "./config.js";

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

      return [
        {
          hash: record.slice(0, firstSeparator),
          subject: record.slice(firstSeparator + 1, secondSeparator),
          body: record.slice(secondSeparator + 1).trim(),
        },
      ];
    });
}

function getCommitsSince(lastTag: string | null): Commit[] {
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";

  const result = spawnSync(
    "git",
    ["log", range, "--no-merges", `--format=${GIT_LOG_FORMAT}`],
    { cwd: ROOT, encoding: "utf8" },
  );

  return parseCommitLog(result.stdout);
}

export function getCommitsSinceLastRelease(scope: ReleaseScope): Commit[] {
  return getCommitsSince(getLastReleaseTag(scope));
}

export interface ChangesSummary {
  lastTag: string | null;
  commitCount: number;
  commits: Commit[];
  oneline: string;
}

export function getChangesSummary(scope: ReleaseScope): ChangesSummary {
  const lastTag = getLastReleaseTag(scope);
  const commits = getCommitsSince(lastTag);

  return {
    lastTag,
    commitCount: commits.length,
    commits,
    oneline: commits.map((c) => `- ${c.subject}`).join("\n"),
  };
}
