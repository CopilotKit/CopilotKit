"use client";

import { useInterrupt, useRenderTool } from "@copilotkit/react-core/v2";
import {
  Activity,
  CircleAlert,
  ClipboardCheck,
  Hourglass,
  Eye,
  FilePen,
  FolderSearch,
  FolderTree,
  GitBranch,
  GitFork,
  Package,
  Search,
  SquareTerminal,
  TestTube2,
  Wrench,
} from "lucide-react";
import { z } from "zod";
import { AGENT_ID } from "@/lib/agent-id";
import { cn } from "@/lib/cn";
import { builtinArgs } from "@/lib/builtin-args";
import { ALWAYS_ASK, useAutoApprove } from "@/lib/auto-approve";
import { relativeToRepo, useWorkspace } from "@/lib/use-workspace";
import { ActivityRow } from "./activity-row";
import { ApprovalCard } from "./approval-card";
import type { ApprovalAnswer } from "./approval-card";
import { CommandOutput } from "./command-output";
import { DiffCard } from "./diff-card";
import { taskLabel } from "@/lib/command-output";
import { shortPaths } from "@/lib/paths";

type Status = "inProgress" | "executing" | "complete";

/** Tool results arrive as JSON strings; built-in tools may return plain text. */
function parseResult(
  result: string | undefined,
): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const value: unknown = JSON.parse(result);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const s = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The error a finished tool reported, if any. A tool that raised reaches the
 * browser as plain text ("There was an error executing ..."), not JSON.
 */
function errorOf(
  result: Record<string, unknown> | null,
  raw?: string,
): string | null {
  if (!result) return raw ? raw.slice(0, 300) : "The tool returned no result.";
  return result.ok === false
    ? s(result.error) || "The tool reported an error."
    : null;
}

function useRepoPath(): string | undefined {
  return useWorkspace().state.repo?.path;
}

/* ───────────────────────── custom tools ───────────────────────── */

function CloneRow({ status, result }: { status: Status; result?: string }) {
  const data = parseResult(result);
  const error = errorOf(data, result);
  if (status !== "complete") {
    return <ActivityRow running icon={null} title="Cloning repository" />;
  }
  if (error) {
    return (
      <ActivityRow
        icon={<GitFork className="size-4" />}
        tone="fail"
        title="Clone failed"
        detail={error}
      />
    );
  }
  return (
    <ActivityRow
      icon={<GitFork className="size-4" />}
      title={`Cloned ${s(data?.slug)}`}
      detail={`${s(data?.branch)} @ ${s(data?.commit)}`}
      meta={s(data?.commitSubject)}
    />
  );
}

interface Workflow {
  workflow: string;
  conclusion: string | null;
  status: string | null;
  url: string | null;
}

function CiRow({ status, result }: { status: Status; result?: string }) {
  const data = parseResult(result);
  const error = errorOf(data, result);
  if (status !== "complete") {
    return <ActivityRow running icon={null} title="Checking CI" />;
  }
  if (error) {
    return (
      <ActivityRow
        icon={<Activity className="size-4" />}
        tone="fail"
        title="Could not read CI"
        detail={error}
      />
    );
  }
  const workflows = (
    Array.isArray(data?.workflows) ? (data.workflows as Workflow[]) : []
  ).slice(0, 6);
  const jobs = Array.isArray(data?.failedJobs)
    ? (data.failedJobs as { name: string }[])
    : [];
  const failing = typeof data?.failing === "number" ? data.failing : 0;
  return (
    <ActivityRow
      icon={<Activity className="size-4" />}
      tone={failing > 0 ? "fail" : "pass"}
      title={`Checked CI on ${s(data?.branch)}`}
      meta={failing > 0 ? `${failing} failing` : "all passing"}
    >
      <ul className="space-y-1.5 rounded-xl border border-line bg-panel px-4 py-3">
        {workflows.map((w) => (
          <li
            key={w.workflow}
            className="flex items-center gap-2.5 text-[15px]"
          >
            <span
              className={cn(
                "size-2 flex-none rounded-full",
                w.conclusion === "success"
                  ? "bg-pass"
                  : w.conclusion === "failure"
                    ? "bg-fail"
                    : "bg-faint",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-text/90">
              {w.workflow}
            </span>
            <span className="flex-none text-[14px] text-faint">
              {w.conclusion ?? w.status ?? ""}
            </span>
          </li>
        ))}
        {jobs.length > 0 && (
          <li className="border-t border-line pt-2 text-[14px] text-fail">
            Failing jobs: {jobs.map((j) => j.name).join(", ")}
          </li>
        )}
      </ul>
    </ActivityRow>
  );
}

function InstallRow({ status, result }: { status: Status; result?: string }) {
  const data = parseResult(result);
  const error = errorOf(data, result);
  if (status !== "complete") {
    return <ActivityRow running icon={null} title="Installing dependencies" />;
  }
  if (error) {
    return (
      <ActivityRow
        icon={<Package className="size-4" />}
        tone="fail"
        title="Install failed"
        detail={error}
      />
    );
  }
  const packages = Array.isArray(data?.packages)
    ? (data.packages as { name: string; version: string }[])
    : [];
  return (
    <ActivityRow
      icon={<Package className="size-4" />}
      title="Installed dependencies"
      meta={
        typeof data?.duration_seconds === "number"
          ? `${data.duration_seconds.toFixed(1)}s`
          : undefined
      }
    >
      {packages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {packages.map((p) => (
            <span
              key={p.name}
              className="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-[14px] text-dim"
            >
              {p.name} <span className="text-text/85">{p.version}</span>
            </span>
          ))}
        </div>
      )}
    </ActivityRow>
  );
}

function TestsRow({
  status,
  result,
  target,
}: {
  status: Status;
  result?: string;
  target?: string;
}) {
  const data = parseResult(result);
  const error = errorOf(data, result);
  if (status !== "complete") {
    return (
      <ActivityRow
        running
        icon={null}
        title="Running tests"
        detail={target || undefined}
      />
    );
  }
  // A finished run paints its own A2UI report card, so only errors show here.
  if (error) {
    return (
      <ActivityRow
        icon={<TestTube2 className="size-4" />}
        tone="fail"
        title="Tests could not run"
        detail={error}
      />
    );
  }
  return null;
}

function CheckCard({
  status,
  args,
  result,
}: {
  status: Status;
  args: Record<string, unknown>;
  result?: string;
}) {
  const data = parseResult(result);
  const command = shortPaths(s(data?.command) || s(args.command));
  const label = s(data?.label) || s(args.label) || "Check";
  if (status !== "complete") {
    return (
      <ActivityRow
        running
        icon={null}
        title="Running a check"
        detail={command}
      />
    );
  }
  const error = errorOf(data, result);
  if (error) {
    return (
      <ActivityRow
        icon={<ClipboardCheck className="size-4" />}
        tone="fail"
        title="Check could not run"
        detail={error}
      />
    );
  }
  const passed = data?.status === "passed";
  const exitCode = typeof data?.exitCode === "number" ? data.exitCode : null;
  const run = typeof data?.run === "number" ? data.run : null;
  const output = s(data?.output_tail);
  return (
    <section
      className="card enter w-full overflow-hidden"
      data-testid="check-card"
      data-chat-block="card"
      data-status={passed ? "passed" : "failed"}
    >
      <header className="flex items-center gap-3 px-4 pt-3">
        <span
          className={cn(
            "flex size-8 flex-none items-center justify-center rounded-lg ring-1 ring-inset",
            passed
              ? "bg-pass/10 text-pass ring-pass/25"
              : "bg-fail/10 text-fail ring-fail/25",
          )}
        >
          <ClipboardCheck className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{run ? `Check ${run}` : "Check"}</p>
          <p
            className="truncate text-[16px] font-semibold tracking-tight"
            title={label}
          >
            {label}
          </p>
        </div>
        <span
          className={cn(
            "flex-none rounded-full px-2.5 py-0.5 text-[14px] font-semibold ring-1 ring-inset",
            passed
              ? "bg-pass/10 text-pass ring-pass/25"
              : "bg-fail/10 text-fail ring-fail/25",
          )}
        >
          {passed ? "Passed" : "Failed"}
        </span>
      </header>
      <div className="space-y-2.5 px-4 pt-2.5 pb-3.5">
        <p className="wrap-code rounded-lg border border-line bg-bg/70 px-3 py-2 font-mono text-[14px] text-text/90">
          <span className="mr-2 select-none text-accent">$</span>
          {command}
        </p>
        <p className="text-[14px] text-faint">
          {data?.timedOut === true
            ? s(data.headline)
            : `Exit ${exitCode ?? "?"}`}
          {typeof data?.durationSeconds === "number" &&
            ` in ${data.durationSeconds.toFixed(1)}s`}
        </p>
        {output.trim() && <CommandOutput output={output} hidden />}
      </div>
    </section>
  );
}

function PushRow({
  status,
  result,
  branch,
}: {
  status: Status;
  result?: string;
  branch?: string;
}) {
  const data = parseResult(result);
  const error = errorOf(data, result);
  if (status !== "complete") {
    return <ActivityRow running icon={null} title="Pushing" detail={branch} />;
  }
  if (error) {
    return (
      <ActivityRow
        icon={<GitBranch className="size-4" />}
        tone="fail"
        title="Push failed"
        detail={error}
      />
    );
  }
  return (
    <ActivityRow
      icon={<GitBranch className="size-4" />}
      tone="pass"
      title={`Pushed ${s(data?.branch)}`}
      detail={s(data?.commit)}
      meta="local demo remote"
    />
  );
}

function DiffBlock({ status, result }: { status: Status; result?: string }) {
  const data = parseResult(result);
  const error = errorOf(data, result);
  if (status !== "complete")
    return <ActivityRow running icon={null} title="Preparing the diff" />;
  if (error || !data)
    return (
      <ActivityRow
        icon={<Wrench className="size-4" />}
        tone="fail"
        title="No diff"
        detail={error ?? ""}
      />
    );
  return <DiffCard summary={s(data.summary)} patch={s(data.patch)} />;
}

/* ───────────────────────── harness built-ins ───────────────────────── */

const FAILED_TITLE: Record<string, string> = {
  view_file: "Could not read",
  search_directory: "Search failed in",
  find_file: "Search failed in",
  list_directory: "Could not list",
  edit_file: "Edit failed in",
};

/**
 * The reason a built-in tool failed, or null. The agent turns a failed tool
 * step into a result that starts "There was an error executing <tool>: ...".
 */
function builtinFailure(result: string | undefined): string | null {
  const match = /^There was an error executing [\w-]+: ([\s\S]*)$/.exec(
    result ?? "",
  );
  if (!match) return null;
  const reason = match[1]!.trim();
  if (/task is not running|not running \(status/i.test(reason))
    return "already finished";
  if (/does not exist|no such file|not found/i.test(reason)) return "not found";
  return (
    reason
      .replace(/file:\/\/\S+/g, "")
      .replace(/\b[0-9a-f]{16,}\//g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "failed"
  );
}

/* Background commands. The harness sends a run_command that outlasts its wait
 * time to the background as a task; the agent turns its `manage_task` calls
 * and the harness's task notices into these calls (agent harness_steps.py). */

function TaskActionRow({
  status,
  args,
  result,
}: {
  status: Status;
  args: Record<string, unknown>;
  result?: string;
}) {
  const running = status !== "complete";
  const action = s(args.action).toLowerCase();
  const stopping = /kill|stop|cancel/.test(action);
  const task = taskLabel(args.task);
  const failure = running ? null : builtinFailure(result);
  if (failure) {
    return (
      <ActivityRow
        icon={<CircleAlert className="size-4" />}
        tone="fail"
        title={
          stopping
            ? "Could not stop background command"
            : "Could not check background command"
        }
        detail={task}
        meta={failure}
      />
    );
  }
  const output = running ? "" : s(parseResult(result)?.output);
  return (
    <ActivityRow
      running={running}
      icon={<Hourglass className="size-4" />}
      title={
        running
          ? stopping
            ? "Stopping background command"
            : "Checking background command"
          : stopping
            ? "Stopped background command"
            : "Checked background command"
      }
      detail={task}
    >
      {output && <CommandOutput output={output} hidden />}
    </ActivityRow>
  );
}

const TASK_TITLE: Record<string, string> = {
  finished: "Background command finished",
  canceled: "Background command canceled",
  failed: "Background command failed",
};

function BackgroundTaskRow({
  status,
  args,
  result,
}: {
  status: Status;
  args: Record<string, unknown>;
  result?: string;
}) {
  const data = parseResult(result);
  const state = s(data?.status);
  const exitCode = typeof data?.exit_code === "number" ? data.exit_code : null;
  const stoppedByAgent = /manage_task/.test(s(data?.reason));
  const tone =
    exitCode === null
      ? state === "failed"
        ? "fail"
        : "default"
      : exitCode === 0
        ? "pass"
        : "fail";
  return (
    <ActivityRow
      running={status !== "complete"}
      icon={<Hourglass className="size-4" />}
      tone={tone}
      title={TASK_TITLE[state] ?? "Background command update"}
      detail={taskLabel(args.task)}
      meta={
        exitCode !== null
          ? `exit ${exitCode}`
          : stoppedByAgent
            ? "stopped by the agent"
            : undefined
      }
    >
      {data && s(data.output).trim() && (
        <CommandOutput output={s(data.output)} hidden />
      )}
    </ActivityRow>
  );
}

function BuiltinRow({
  name,
  status,
  args,
  result,
}: {
  name: string;
  status: Status;
  args: Record<string, unknown>;
  result?: string;
}) {
  const repoPath = useRepoPath();
  const rel = (value: string) => relativeToRepo(value, repoPath);
  // A folder for people: the repo root when the tool names none or the root.
  const place = (value: string) => {
    const relative = rel(value);
    return !relative || relative === "." ? (
      <span className="font-sans">repo root</span>
    ) : (
      relative
    );
  };
  const running = status !== "complete";
  if (name === "manage_task")
    return <TaskActionRow status={status} args={args} result={result} />;
  if (name === "background_task")
    return <BackgroundTaskRow status={status} args={args} result={result} />;
  const path = builtinArgs.filePath(args);
  const dir = builtinArgs.directory(args);
  const failure = running ? null : builtinFailure(result);

  if (failure) {
    return (
      <ActivityRow
        icon={<CircleAlert className="size-4" />}
        tone="fail"
        title={FAILED_TITLE[name] ?? `${name.replaceAll("_", " ")} failed`}
        detail={path ? rel(path) : place(dir)}
        meta={failure}
      />
    );
  }

  switch (name) {
    case "view_file":
      return (
        <ActivityRow
          running={running}
          icon={<Eye className="size-4" />}
          title="Read"
          detail={rel(path)}
          meta={builtinArgs.lineRange(args)}
        />
      );
    case "search_directory":
      return (
        <ActivityRow
          running={running}
          icon={<Search className="size-4" />}
          title="Searched"
          detail={
            <>
              <span className="text-text/85">{builtinArgs.query(args)}</span>
              <span className="text-faint"> in </span>
              {place(dir)}
            </>
          }
        />
      );
    case "find_file": {
      const { directory, pattern } = builtinArgs.findFile(args);
      if (!pattern || pattern === "*") {
        return (
          <ActivityRow
            running={running}
            icon={<FolderSearch className="size-4" />}
            title="Listed files in"
            detail={place(directory)}
          />
        );
      }
      return (
        <ActivityRow
          running={running}
          icon={<FolderSearch className="size-4" />}
          title="Looked for"
          detail={
            <>
              <span className="text-text/85">{pattern}</span>
              <span className="text-faint"> in </span>
              {place(directory)}
            </>
          }
        />
      );
    }
    case "list_directory":
      return (
        <ActivityRow
          running={running}
          icon={<FolderTree className="size-4" />}
          title="Listed"
          detail={place(dir)}
        />
      );
    case "edit_file":
      return (
        <ActivityRow
          running={running}
          icon={<FilePen className="size-4" />}
          tone="pass"
          title="Edited"
          detail={rel(path)}
        />
      );
    case "run_command": {
      // The harness reports `{ exit_code, combined_output }`.
      const outcome = parseResult(result);
      const exitCode =
        typeof outcome?.exit_code === "number" ? outcome.exit_code : null;
      const output = outcome ? s(outcome.combined_output) : (result ?? "");
      // A command that outlasts its wait time keeps running as a background task.
      const background =
        !running && exitCode === null && /background|task-\d+/i.test(output);
      return (
        <ActivityRow
          running={running}
          icon={<SquareTerminal className="size-4" />}
          tone={
            exitCode === null || running
              ? "default"
              : exitCode === 0
                ? "pass"
                : "fail"
          }
          title={background ? "Started in background" : "Ran"}
          detail={shortPaths(builtinArgs.commandLine(args))}
          meta={exitCode === null || running ? undefined : `exit ${exitCode}`}
        >
          {!running && output.trim() && <CommandOutput output={output} />}
        </ActivityRow>
      );
    }
    case "harness_action":
      return (
        <ActivityRow
          running={running}
          icon={<Wrench className="size-4" />}
          title={s(args.label) || "Harness action"}
        />
      );
    default:
      return (
        <ActivityRow
          running={running}
          icon={<Wrench className="size-4" />}
          title={name.replaceAll("_", " ")}
        />
      );
  }
}

/* ───────────────────────── registration ───────────────────────── */

const Any = z.record(z.unknown());

/** Registers every tool renderer and the approval interrupt handler. */
export function ToolRenderers() {
  const repoPath = useRepoPath();
  const { autoApprove } = useAutoApprove();

  useRenderTool({
    name: "clone_repo",
    agentId: AGENT_ID,
    parameters: Any,
    render: (p) => <CloneRow status={p.status} result={p.result} />,
  });
  useRenderTool({
    name: "ci_status",
    agentId: AGENT_ID,
    parameters: Any,
    render: (p) => <CiRow status={p.status} result={p.result} />,
  });
  useRenderTool({
    name: "install_dependencies",
    agentId: AGENT_ID,
    parameters: Any,
    render: (p) => <InstallRow status={p.status} result={p.result} />,
  });
  useRenderTool({
    name: "run_tests",
    agentId: AGENT_ID,
    parameters: Any,
    render: (p) => (
      <TestsRow
        status={p.status}
        result={p.result}
        target={s(p.parameters?.target)}
      />
    ),
  });
  useRenderTool({
    name: "run_check",
    agentId: AGENT_ID,
    parameters: Any,
    render: (p) => (
      <CheckCard
        status={p.status}
        args={p.parameters ?? {}}
        result={p.result}
      />
    ),
  });
  useRenderTool({
    name: "show_diff",
    agentId: AGENT_ID,
    parameters: Any,
    render: (p) => <DiffBlock status={p.status} result={p.result} />,
  });
  useRenderTool({
    name: "git_push",
    agentId: AGENT_ID,
    parameters: Any,
    render: (p) => (
      <PushRow
        status={p.status}
        result={p.result}
        branch={s(p.parameters?.branch)}
      />
    ),
  });
  useRenderTool({
    name: "*",
    agentId: AGENT_ID,
    render: (p: {
      name: string;
      status: Status;
      parameters?: Record<string, unknown>;
      result?: string;
    }) => (
      <BuiltinRow
        name={p.name}
        status={p.status}
        args={p.parameters ?? {}}
        result={p.result}
      />
    ),
  });

  // Every risky call parks on an AG-UI interrupt (reason "tool_approval").
  // `resolve` answers it through RunAgentInput.resume, which the adapter
  // matches to the parked call by interrupt id.
  useInterrupt({
    agentId: AGENT_ID,
    enabled: (event) =>
      (event.value as { reason?: string } | undefined)?.reason ===
      "tool_approval",
    render: ({ interrupt, resolve }) => {
      const { tool_name, args, ...meta } = (interrupt?.metadata ?? {}) as {
        tool_name?: string;
        args?: Record<string, unknown>;
      } & Record<string, unknown>;
      const tool = tool_name ?? "tool";
      return (
        <ApprovalCard
          key={interrupt?.id}
          request={{ tool, args: args ?? {}, meta }}
          repoPath={repoPath}
          // Pushes always ask (ALWAYS_ASK). The answer carries `auto: true`,
          // so the agent's approval history notes it.
          autoApprove={autoApprove && !ALWAYS_ASK.has(tool)}
          onAnswer={(answer: ApprovalAnswer) => resolve(answer, interrupt?.id)}
        />
      );
    },
  });

  return null;
}
