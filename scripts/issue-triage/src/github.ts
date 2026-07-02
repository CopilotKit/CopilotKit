import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { LABEL_COLORS } from "./labels";

export function hasChanges(cwd: string): boolean {
  return (
    execFileSync("git", ["status", "--porcelain"], { cwd }).toString().trim()
      .length > 0
  );
}

type Repo = { owner: string; repo: string };
export async function postComment(
  o: Repo & { octokit: Octokit; issue: number; body: string },
) {
  await o.octokit.rest.issues.createComment({
    owner: o.owner,
    repo: o.repo,
    issue_number: o.issue,
    body: o.body,
  });
}
export async function ensureLabels(
  o: Repo & { octokit: Octokit; labels: string[] },
) {
  for (const name of o.labels) {
    try {
      await o.octokit.rest.issues.getLabel({
        owner: o.owner,
        repo: o.repo,
        name,
      });
    } catch {
      await o.octokit.rest.issues.createLabel({
        owner: o.owner,
        repo: o.repo,
        name,
        color: LABEL_COLORS[name] ?? "ededed",
      });
    }
  }
}
export async function applyLabels(
  o: Repo & { octokit: Octokit; issue: number; labels: string[] },
) {
  if (o.labels.length)
    await o.octokit.rest.issues.addLabels({
      owner: o.owner,
      repo: o.repo,
      issue_number: o.issue,
      labels: o.labels,
    });
}
export function openFixPR(
  o: Repo & { cwd: string; issue: number; summary: string; token: string },
): string {
  const branch = `fix/issue-${o.issue}`;
  const env = {
    ...process.env,
    GH_TOKEN: o.token,
    GIT_AUTHOR_NAME: "copilotkit-bot",
    GIT_AUTHOR_EMAIL: "bot@copilotkit.ai",
    GIT_COMMITTER_NAME: "copilotkit-bot",
    GIT_COMMITTER_EMAIL: "bot@copilotkit.ai",
  };
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: o.cwd, env }).toString();
  git("checkout", "-b", branch);
  git("add", "-A");
  git("commit", "-m", `fix: address issue #${o.issue}`);
  git("push", "-u", "origin", branch, "--force-with-lease");
  return execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `fix: address issue #${o.issue}`,
      "--body",
      `Closes #${o.issue}\n\n${o.summary}\n\n_Opened by /fix bot — review before merge._`,
      "--head",
      branch,
    ],
    { cwd: o.cwd, env },
  )
    .toString()
    .trim();
}
