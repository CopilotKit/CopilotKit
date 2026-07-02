import { Octokit } from "@octokit/rest";
import { buildSandbox } from "./sandbox";
import { runAgent } from "./run";
import { triagePrompt, fixPrompt } from "./prompt";
import { resolveLabels } from "./labels";
import {
  hasChanges,
  postComment,
  ensureLabels,
  applyLabels,
  openFixPR,
} from "./github";
import { parseCommand } from "./args";

const env = (k: string, d = "") => process.env[k] ?? d;
async function main() {
  const parsed = parseCommand(env("BODY"));
  if (!parsed) {
    console.error("No /triage or /fix command found in comment body");
    process.exit(1);
  }
  const { command, deep } = parsed;
  const [owner, repo] = env("REPO").split("/");
  const issue = Number(env("ISSUE_NUMBER"));
  const sourcePath = env("SOURCE_PATH", process.cwd());
  const ghToken = env("GH_TOKEN");
  const dryRun = env("DRY_RUN") === "true";
  const octokit = new Octokit({ auth: ghToken });
  const { withSandbox } = buildSandbox({ sourcePath, ghToken });
  const model =
    command === "fix" || deep ? "claude-opus-4-8" : "claude-sonnet-5";
  const info = { title: env("ISSUE_TITLE"), body: env("ISSUE_BODY") };

  if (command === "triage") {
    const { system, user } = triagePrompt(info);
    const { text, meta } = await runAgent({
      model,
      permissionMode: "plan",
      maxTurns: 40,
      system,
      user,
      withSandbox,
    });
    const labels = resolveLabels(meta?.labels ?? []);
    if (dryRun) {
      console.log(text, "\nlabels:", labels);
      return;
    }
    await postComment({ octokit, owner, repo, issue, body: text });
    await ensureLabels({ octokit, owner, repo, labels });
    await applyLabels({ octokit, owner, repo, issue, labels });
  } else {
    const { system, user } = fixPrompt({
      ...info,
      number: issue,
      priorComments: env("PRIOR_COMMENTS"),
    });
    const { text } = await runAgent({
      model,
      permissionMode: "acceptEdits",
      maxTurns: 60,
      system,
      user,
      withSandbox,
    });
    if (!hasChanges(sourcePath)) {
      const body = `/fix ran but made no code changes.\n\n${text}`;
      if (!dryRun) await postComment({ octokit, owner, repo, issue, body });
      else console.log(body);
      return;
    }
    if (dryRun) {
      console.log("would open PR with summary:\n", text);
      return;
    }
    const prUrl = openFixPR({
      owner,
      repo,
      cwd: sourcePath,
      issue,
      summary: text,
      token: ghToken,
    });
    await postComment({
      octokit,
      owner,
      repo,
      issue,
      body: `Opened a fix PR: ${prUrl}`,
    });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
