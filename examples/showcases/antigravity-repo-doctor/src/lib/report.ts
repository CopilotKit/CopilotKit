import type { AgentState, Check } from "./agent-state";
import { builtinArgs } from "./builtin-args";
import { taskLabel } from "./command-output";
import { shortPaths } from "./paths";

/**
 * The conversation at a glance, as Markdown: what was asked, what the agent
 * said, and one line per step it took, in order. Built in the browser from the
 * thread's messages and shared state. No model or server call: a reopened
 * thread brings both back, so the same report can be rebuilt later.
 */

interface ToolCall {
  id: string;
  function?: { name?: string; arguments?: string };
}

interface Message {
  role: string;
  content?: unknown;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

interface Call {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

/** Tools that stop on an approval card. */
const NEEDS_APPROVAL = new Set([
  "install_dependencies",
  "run_check",
  "run_command",
  "edit_file",
  "git_push",
  "manage_task",
]);

const TOOL_NAME: Record<string, string> = {
  install_dependencies: "Install",
  run_check: "Check",
  run_command: "Command",
  edit_file: "Edit",
  git_push: "Push",
  manage_task: "Background command",
};

const s = (value: unknown): string => (typeof value === "string" ? value : "");

function parseObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Inline code that survives backticks in the value. */
function code(raw: string): string {
  const value = shortPaths(raw);
  const longest = Math.max(
    0,
    ...(value.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  return longest > 0 || value.startsWith("`") || value.endsWith("`")
    ? `${fence} ${value} ${fence}`
    : `${fence}${value}${fence}`;
}

function fenced(body: string, lang: string): string {
  const longest = Math.max(
    0,
    ...(body.match(/`{3,}/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body.replace(/\n+$/, "")}\n${fence}`;
}

/** Links to files become inline code; web links stay. */
function unlinkPaths(text: string): string {
  return shortPaths(text).replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (whole, label: string, target: string) =>
      /^(https?:|mailto:)/i.test(target)
        ? whole
        : code(label.replace(/^`+|`+$/g, "")),
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in local time. */
export function reportDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function reportFilename(state: AgentState, now: Date): string {
  const [owner, name] = (state.repo?.slug ?? "").split("/");
  const slug = owner && name ? `${owner}-${name}` : "report";
  return `repo-doctor-${slug.replace(/[^\w.-]+/g, "-")}-${reportDate(now)}.md`;
}

function relative(path: string, repoPath: string | undefined): string {
  const clean = path.replace(/^file:\/\//, "");
  if (repoPath && clean === repoPath) return "";
  return repoPath && clean.startsWith(`${repoPath}/`)
    ? clean.slice(repoPath.length + 1)
    : clean;
}

/** What the CI check found, in one line. */
function ciLine(result: Record<string, unknown> | null): string {
  if (!result) return "Checked CI";
  if (result.ok === false)
    return `Could not read CI: ${s(result.error) || "unknown error"}`;
  const workflows = Array.isArray(result.workflows)
    ? (result.workflows as Record<string, unknown>[])
    : [];
  const failing = workflows.filter(
    (w) => w.conclusion === "failure" || w.conclusion === "timed_out",
  );
  if (failing.length === 0)
    return `Checked CI: passing on ${code(s(result.branch) || "the default branch")}`;
  const jobs = Array.isArray(result.failedJobs)
    ? (result.failedJobs as Record<string, unknown>[])
    : [];
  const where = jobs
    .map((job) => {
      const steps = Array.isArray(job.failedSteps)
        ? job.failedSteps.filter((x): x is string => typeof x === "string")
        : [];
      return `${s(job.name)}${steps.length ? ` at step ${steps.join(", ")}` : ""}`;
    })
    .join("; ");
  const names = failing
    .map((w) => `${s(w.workflow)}${s(w.file) ? ` (${code(s(w.file))})` : ""}`)
    .join(", ");
  return `Checked CI: ${names} failing${where ? `, job ${where}` : ""}`;
}

/** "`cmd` (label): failed, exit 1, 2.3s" for one check run. */
function checkLine(check: Check): string {
  return `${code(check.command)} (${check.label}): ${check.headline}, ${check.durationSeconds.toFixed(1)}s`;
}

/**
 * The before and after of the CI reproduction. A fix counts as verified only
 * when a check failed and the same command later passed.
 */
function checkVerification(checks: readonly Check[]): string[] {
  if (checks.length === 0) return ["- No check reproduced the CI failure."];
  const lines = checks.map((c) => `- Check ${c.run}: ${checkLine(c)}`);
  const firstFail = checks.find((c) => c.status === "failed");
  const laterPass =
    firstFail &&
    checks.find(
      (c) =>
        c.run > firstFail.run &&
        c.status === "passed" &&
        c.command === firstFail.command,
    );
  if (firstFail && laterPass) {
    lines.push(
      `- Before the fix: ${code(firstFail.command)} ${firstFail.exitCode === null ? "timed out" : `exited ${firstFail.exitCode}`}. After: exited ${laterPass.exitCode ?? "?"}. Red to green.`,
    );
  } else if (!firstFail) {
    lines.push(
      "- The check never failed, so it did not reproduce the CI failure.",
    );
  } else {
    lines.push(
      "- The same check never passed after failing, so the fix is not verified by a check.",
    );
  }
  return lines;
}

/** One line for a tool step, worded like its row in the chat. */
function stepLine(call: Call, repoPath: string | undefined): string | null {
  const r = call.result;
  const failed = r?.ok === false ? `: failed, ${s(r.error) || "error"}` : "";
  const path = (p: string) => code(relative(p, repoPath) || "repo root");
  switch (call.name) {
    case "clone_repo":
      return `Cloned ${code(s(r?.slug) || s(call.args.repo) || "the repository")}${failed}`;
    case "ci_status":
      return ciLine(r);
    case "install_dependencies":
      return `Installed dependencies with ${code(s(call.args.command) || s(r?.command))}${failed}`;
    case "run_check": {
      const status = s(r?.status);
      if (!status)
        return `Ran a check ${code(s(call.args.command) || "(command)")}${failed || ": no result"}`;
      return `Ran check ${typeof r?.run === "number" ? `${r.run} ` : ""}${code(s(r?.command) || s(call.args.command))}${s(r?.label) ? ` (${s(r?.label)})` : ""}: ${s(r?.headline) || status}`;
    }
    case "run_tests":
      return `Ran the tests: ${s(r?.headline) || (failed ? failed.slice(2) : "no result")}`;
    case "run_command": {
      const exit = typeof r?.exit_code === "number" ? r.exit_code : null;
      const outcome =
        exit === null
          ? r
            ? "sent to the background"
            : "no result"
          : exit === 0
            ? "exit 0"
            : `exit ${exit}, failed`;
      return `Ran ${code(builtinArgs.commandLine(call.args) || "(command)")}: ${outcome}`;
    }
    case "background_task": {
      const exit =
        typeof r?.exit_code === "number" ? `, exit ${r.exit_code}` : "";
      return `Background command ${taskLabel(call.args.task)}: ${s(r?.status) || "update"}${exit}`;
    }
    case "view_file":
      return `Read ${path(builtinArgs.filePath(call.args))}`;
    case "list_directory":
    case "find_file":
      return `Listed ${path(builtinArgs.filePath(call.args) || builtinArgs.directory(call.args))}`;
    case "search_directory":
      return `Searched for ${code(builtinArgs.query(call.args))}`;
    case "edit_file":
      return `Edited ${path(builtinArgs.filePath(call.args))}`;
    case "git_push": {
      const commit = s(r?.commit);
      return `Pushed ${code(s(r?.branch) || s(call.args.branch))}${commit ? ` (${code(commit)})` : ""} to the local demo remote${failed}`;
    }
    case "manage_task":
      return null;
    default:
      return call.name ? `${call.name}${failed}` : null;
  }
}

function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The agent's one-line note before a step. Only its first sentence, and
 * nothing that is pasted command output or a harness notice.
 */
function stepReason(text: string): string {
  const flat = unlinkPaths(text)
    .replace(/\s*\n+\s*/g, " ")
    .trim();
  if (/^\[Message\]|Task id "|task-\d+|Output:|Log: file:/i.test(flat))
    return "";
  const first = flat.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? flat;
  return first.length > 220 ? `${first.slice(0, 217).trimEnd()}...` : first;
}

/** The agent's final message: its root cause, fix and verification. */
function finalMessage(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (
      m.role === "assistant" &&
      typeof m.content === "string" &&
      m.content.trim()
    )
      return m.content.trim();
  }
  return "";
}

/**
 * The report as Markdown, for someone who was not in the conversation: why
 * CI failed and what was changed, the diff, how it was verified, every step
 * the agent took (with its own reason and the approval it needed), every
 * approval, and what was pushed. Pure: same input, same output.
 */
export function buildReport({
  state,
  messages,
  now,
}: {
  state: AgentState;
  messages: readonly unknown[];
  now: Date;
}): string {
  const msgs = messages.filter(
    (m): m is Message => !!m && typeof m === "object" && "role" in m,
  );
  const results = new Map<string, unknown>();
  for (const m of msgs)
    if (m.role === "tool" && m.toolCallId) results.set(m.toolCallId, m.content);
  const repo = state.repo;
  const summary = finalMessage(msgs);

  // Approval decisions in order, matched to the risky steps they answered.
  const decisions = [...state.approvals];
  const decisionFor = (tool: string): string => {
    const i = decisions.findIndex((a) => a.tool === tool);
    if (i < 0) return "";
    const [a] = decisions.splice(i, 1);
    if (!a) return "";
    if (a.decision !== "approved")
      return `denied${a.note ? `: "${a.note}"` : ""}`;
    return a.note === "auto"
      ? "auto-approved"
      : `approved${a.note ? `: "${a.note}"` : ""}`;
  };

  // Walk the thread once: the agent's reason for each group of steps, the
  // steps under it, the CI check and the diffs.
  const steps: string[] = [];
  const patches: string[] = [];
  let ci: Record<string, unknown> | null = null;
  let reason = "";
  let testRun = 0;
  const seenIds = new Set<string>();
  const seenLines = new Set<string>();
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    const text = typeof m.content === "string" ? m.content.trim() : "";
    if (text && text !== summary) reason = stepReason(text);
    for (const c of m.toolCalls ?? []) {
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      const call: Call = {
        name: c.function?.name ?? "",
        args: parseObject(c.function?.arguments) ?? {},
        result: parseObject(results.get(c.id)),
      };
      if (call.name === "ci_status" && call.result) ci = call.result;
      if (call.name === "show_diff") {
        const patch = s(call.result?.patch);
        if (patch && !patches.includes(patch)) patches.push(patch);
        continue;
      }
      if (call.name === "harness_action" || call.name === "manage_task")
        continue;
      let line: string | null;
      if (call.name === "run_tests") {
        const run = state.testRuns[testRun++];
        line = run
          ? `Ran the tests: ${run.headline}`
          : `Ran the tests${call.result?.ok === false ? `: failed, ${s(call.result.error)}` : ""}`;
      } else {
        line = stepLine(call, repo?.path);
      }
      if (!line) continue;
      // The same call re-sent after an approval (no result the second time).
      if (
        line.endsWith(": no result") &&
        [...seenLines].some((l) =>
          l.startsWith(line!.replace(/: no result$/, ":")),
        )
      )
        continue;
      seenLines.add(line);
      const decision = NEEDS_APPROVAL.has(call.name)
        ? decisionFor(call.name)
        : "";
      const why = reason ? ` ${reason}` : "";
      reason = "";
      steps.push(
        `${steps.length + 1}. ${line}${decision ? ` (${decision})` : ""}.${why ? ` Why:${why}` : ""}`,
      );
    }
  }

  const out: string[] = [];
  const section = (title: string, body: string[]) =>
    out.push(`## ${title}`, "", ...body, "");

  out.push(`# Repo doctor report: ${repo?.slug ?? "no repository"}`, "");
  out.push(
    `Date: ${reportDate(now)}${repo ? `. Repository ${code(repo.slug)}, branch ${code(repo.branch)}, commit ${code(repo.commit)}${repo.commitSubject ? ` (${repo.commitSubject})` : ""}.` : "."}`,
    "",
  );

  section("Why CI was failing", [
    ciLine(ci).replace(/^Checked CI: /, "") + ".",
  ]);
  section("Root cause and fix", [
    summary ? unlinkPaths(summary) : "The agent has not written a summary yet.",
  ]);
  section(
    "The change",
    patches.length === 0
      ? ["No change was made."]
      : patches.flatMap((patch) => [fenced(patch, "diff"), ""]).slice(0, -1),
  );
  section("Verification", [
    "Check (reproduction of the failing CI step):",
    "",
    ...checkVerification(state.checks),
    "",
    "Tests:",
    "",
    ...(state.testRuns.length === 0
      ? ["- The tests were not run."]
      : state.testRuns.map(
          (run) =>
            `- Test run ${run.run}${run.target ? ` (${code(run.target)})` : ""}: ${run.headline}, ${run.durationSeconds.toFixed(1)}s`,
        )),
  ]);
  section("What the agent did", steps.length === 0 ? ["No steps."] : steps);
  section(
    `Approvals (${state.approvals.length})`,
    state.approvals.length === 0
      ? ["Nothing needed approval."]
      : state.approvals.map((a) => {
          const auto = a.decision === "approved" && a.note === "auto";
          const verdict =
            a.decision !== "approved"
              ? "Denied"
              : auto
                ? "Auto-approved"
                : "Approved by a person";
          const note = a.note && !auto ? `, note: "${a.note}"` : "";
          return `- ${clock(a.at)}: ${verdict}, ${(TOOL_NAME[a.tool] ?? a.tool).toLowerCase()}${a.summary ? ` ${code(a.summary)}` : ""}${note}`;
        }),
  );
  section(
    "Result",
    state.push
      ? [
          `Pushed branch ${code(state.push.branch)} (commit ${code(state.push.commit)}) with ${state.push.files.map(code).join(", ") || "no files"} to the demo's local remote. GitHub is untouched; open a pull request from this branch to ship the fix.`,
        ]
      : ["Nothing was pushed."],
  );

  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/** Saves the report as a .md file through a Blob and a temporary link. */
export function downloadReport(
  state: AgentState,
  messages: readonly unknown[],
  now = new Date(),
): void {
  const blob = new Blob([buildReport({ state, messages, now })], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = reportFilename(state, now);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
