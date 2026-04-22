import { spawnSync } from "child_process";
import { ROOT } from "./config.js";

export function getLastReleaseTag(): string | null {
  const result = spawnSync(
    "git",
    ["tag", "--list", "v*", "--sort=-v:refname"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const tags = result.stdout.trim().split("\n").filter(Boolean);

  for (const tag of tags) {
    if (/^v\d+\.\d+\.\d+$/.test(tag)) {
      return tag;
    }
  }

  return null;
}

export interface Commit {
  hash: string;
  subject: string;
}

export function getCommitsSinceLastRelease(): Commit[] {
  const lastTag = getLastReleaseTag();
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";

  const result = spawnSync(
    "git",
    ["log", range, "--oneline", "--no-merges", "--format=%H %s"],
    { cwd: ROOT, encoding: "utf8" },
  );

  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      return {
        hash: line.slice(0, spaceIdx),
        subject: line.slice(spaceIdx + 1),
      };
    });
}

export interface ChangesSummary {
  lastTag: string | null;
  commitCount: number;
  commits: Commit[];
  oneline: string;
}

export function getChangesSummary(): ChangesSummary {
  const lastTag = getLastReleaseTag();
  const commits = getCommitsSinceLastRelease();

  return {
    lastTag,
    commitCount: commits.length,
    commits,
    oneline: commits.map((c) => `- ${c.subject}`).join("\n"),
  };
}
