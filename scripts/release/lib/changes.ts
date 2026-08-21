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

function getCommitsSince(lastTag: string | null): Commit[] {
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";

  const result = spawnSync(
    "git",
    ["log", range, "--no-merges", "--format=%H%x1f%s%x1f%B%x1e"],
    { cwd: ROOT, encoding: "utf8" },
  );

  return result.stdout
    .split("\x1e")
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body] = record.trim().split("\x1f");
      return {
        hash: hash ?? "",
        subject: subject ?? "",
        body: (body ?? "").trim(),
      };
    })
    .filter((c) => c.hash.length > 0);
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
