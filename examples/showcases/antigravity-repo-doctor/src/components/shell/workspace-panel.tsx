"use client";

import type { ReactNode } from "react";
import { Check, Download, ExternalLink, GitBranch, X } from "lucide-react";
import type { Approval, Check as CheckRun, TestRun } from "@/lib/agent-state";
import { useWorkspace } from "@/lib/use-workspace";
import { downloadReport } from "@/lib/report";
import { StatusPill, TestBar } from "@/components/ui/status";
import type { RunStatus } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { shortPaths } from "@/lib/paths";

const TOOL_LABEL: Record<string, string> = {
  install_dependencies: "Install",
  run_check: "Check",
  run_command: "Command",
  edit_file: "Edit",
  git_push: "Push",
};

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line px-5 py-5 last:border-b-0">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="eyebrow">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[15.5px] leading-relaxed text-faint">{children}</p>;
}

/** Live view of the workspace: repo, tests, approvals and the push. */
export function WorkspacePanel() {
  const { state, testsRunning, checkRunning, messages, running } =
    useWorkspace();
  // After the agent has answered at least once, and not mid-run.
  const canReport =
    !running &&
    messages.some((m) => (m as { role?: string } | null)?.role === "assistant");
  const latest = state.testRuns.at(-1);
  const status: RunStatus = testsRunning
    ? "running"
    : (latest?.status ?? "idle");
  const latestCheck = state.checks.at(-1);
  const checkStatus: RunStatus = checkRunning
    ? "running"
    : (latestCheck?.status ?? "idle");

  return (
    <aside
      className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto border-l border-line bg-surface"
      data-testid="workspace-panel"
    >
      <Section title="Repository">
        {state.repo ? (
          <div className="space-y-2.5">
            <a
              href={`https://github.com/${state.repo.slug}`}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-1.5 text-[17px] font-semibold tracking-tight hover:text-accent"
            >
              {state.repo.slug}
              <ExternalLink
                className="size-3.5 text-faint group-hover:text-accent"
                aria-hidden
              />
            </a>
            <p className="flex items-center gap-2 font-mono text-[14px] text-dim">
              <GitBranch className="size-3" aria-hidden />
              {state.repo.branch}
              <span className="text-faint">@</span>
              {state.repo.commit}
            </p>
            <p className="line-clamp-2 text-[15.5px] leading-relaxed text-dim">
              {state.repo.commitSubject}
            </p>
            {state.install && state.install.packages.length > 0 && (
              <details className="group pt-0.5">
                <summary className="cursor-pointer list-none text-[15px] text-dim hover:text-text">
                  {state.install.packages.length}{" "}
                  {state.install.packages.length === 1 ? "package" : "packages"}{" "}
                  installed
                  <span className="ml-1.5 text-faint group-open:hidden">
                    Show
                  </span>
                  <span className="ml-1.5 hidden text-faint group-open:inline">
                    Hide
                  </span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {state.install.packages.map((p) => (
                    <span
                      key={p.name}
                      className="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-[14px] text-dim"
                    >
                      {p.name} <span className="text-text/85">{p.version}</span>
                    </span>
                  ))}
                </div>
              </details>
            )}
          </div>
        ) : (
          <Empty>
            Nothing cloned yet. Name a public GitHub repository in the chat.
          </Empty>
        )}
      </Section>

      <Section
        title="Check"
        aside={<StatusPill status={checkStatus} idleLabel="No checks yet" />}
      >
        {latestCheck ? (
          <div>
            <p
              className="truncate text-[17px] font-semibold tracking-tight"
              title={latestCheck.label}
            >
              {latestCheck.label}
            </p>
            <p className="wrap-code mt-1 font-mono text-[14px] text-dim">
              {shortPaths(latestCheck.command)}
            </p>
            <ol className="mt-4 space-y-1.5" aria-label="Check runs">
              {state.checks.map((check) => (
                <CheckRow
                  key={check.run}
                  check={check}
                  latest={check.run === latestCheck.run}
                />
              ))}
            </ol>
          </div>
        ) : (
          <Empty>
            {checkRunning
              ? "Running the first check."
              : "When CI fails, the agent runs the failing step here. It should fail before the fix and pass after."}
          </Empty>
        )}
      </Section>

      <Section title="Tests" aside={<StatusPill status={status} />}>
        {latest ? (
          <div>
            {latest.total > 0 ? (
              <>
                <p className="text-[30px] font-semibold tracking-tight tabular-nums">
                  {latest.passed}
                  <span className="text-[17px] font-normal text-faint">
                    {" "}
                    / {latest.passed + latest.failed} passing
                    {latest.total > latest.passed + latest.failed &&
                      `, ${latest.total - latest.passed - latest.failed} skipped`}
                  </span>
                </p>
                <TestBar
                  passed={latest.passed}
                  failed={latest.failed}
                  className="mt-3"
                />
              </>
            ) : (
              // A runner that printed no counts: its headline is all there is.
              <p className="text-[19px] font-semibold tracking-tight">
                {latest.headline}
              </p>
            )}
            <ol className="mt-4 space-y-1.5" aria-label="Test runs">
              {state.testRuns.map((run) => (
                <RunRow
                  key={run.run}
                  run={run}
                  latest={run.run === latest.run}
                />
              ))}
            </ol>
          </div>
        ) : (
          <Empty>
            {testsRunning
              ? "Running the suite for the first time."
              : "Results show here after the agent runs the tests."}
          </Empty>
        )}
      </Section>

      <Section
        title="Approvals"
        aside={
          state.approvals.length > 0 ? (
            <span className="text-[14px] text-faint tabular-nums">
              {state.approvals.length}
            </span>
          ) : undefined
        }
      >
        {state.approvals.length > 0 ? (
          <ol className="space-y-2" aria-label="Approval history">
            {[...state.approvals].toReversed().map((a) => (
              <ApprovalRow key={a.id} approval={a} />
            ))}
          </ol>
        ) : (
          <Empty>
            Installs, checks, file edits, shell commands and pushes wait for
            your answer. Every decision is kept here with the conversation.
          </Empty>
        )}
      </Section>

      {state.push && (
        <Section title="Pushed">
          <div className="rounded-lg border border-pass/20 bg-pass/[0.05] px-3 py-2.5">
            <p className="flex items-center gap-2 font-mono text-[15px] text-text/90">
              <GitBranch className="size-4 text-pass" aria-hidden />
              {state.push.branch}
              <span className="text-faint">{state.push.commit}</span>
            </p>
            <p className="mt-1 text-[15px] text-dim">
              {state.push.files.length}{" "}
              {state.push.files.length === 1 ? "file" : "files"} to the local
              demo remote. GitHub is untouched.
            </p>
          </div>
        </Section>
      )}

      {canReport && (
        <div className="sticky bottom-0 mt-auto border-t border-line bg-surface px-5 py-4">
          <button
            type="button"
            onClick={() => downloadReport(state, messages)}
            data-testid="download-report"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3.5 text-[15px] font-medium text-text transition-colors hover:border-line-strong hover:bg-raised"
          >
            <Download className="size-[18px]" aria-hidden />
            Download report
          </button>
        </div>
      )}
    </aside>
  );
}

function RunRow({ run, latest }: { run: TestRun; latest: boolean }) {
  const passed = run.status === "passed";
  return (
    <li
      className={cn(
        "flex items-center gap-2.5 text-[15.5px]",
        !latest && "opacity-60",
      )}
    >
      <span
        className={cn(
          "size-2 flex-none rounded-full",
          passed ? "bg-pass" : run.status === "error" ? "bg-warn" : "bg-fail",
        )}
      />
      <span className="w-12 flex-none text-faint">Run {run.run}</span>
      <span className="min-w-0 flex-1 truncate text-text/85">
        {run.headline}
      </span>
      <span className="flex-none font-mono text-[14px] text-faint tabular-nums">
        {run.durationSeconds.toFixed(1)}s
      </span>
    </li>
  );
}

function CheckRow({ check, latest }: { check: CheckRun; latest: boolean }) {
  const passed = check.status === "passed";
  return (
    <li
      className={cn(
        "flex items-center gap-2.5 text-[15.5px]",
        !latest && "opacity-60",
      )}
      title={shortPaths(check.command)}
    >
      <span
        className={cn(
          "size-2 flex-none rounded-full",
          passed ? "bg-pass" : "bg-fail",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-text/85">
        Check {check.run}: {check.headline}
      </span>
      <span className="flex-none font-mono text-[14px] text-faint tabular-nums">
        {check.durationSeconds.toFixed(1)}s
      </span>
    </li>
  );
}

function ApprovalRow({ approval }: { approval: Approval }) {
  const approved = approval.decision === "approved";
  // The Auto-approve switch answered, not a click (agent approvals.py).
  const auto = approved && approval.note === "auto";
  const time = new Date(approval.at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li className="flex gap-2.5">
      <span
        className={cn(
          "flex size-6 flex-none items-center justify-center rounded-full",
          approved ? "bg-pass/12 text-pass" : "bg-fail/12 text-fail",
        )}
      >
        {approved ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <X className="size-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-2 text-[15.5px]">
          <span className="min-w-0 truncate text-text/90">
            {approved ? "Approved" : "Denied"}{" "}
            {(TOOL_LABEL[approval.tool] ?? approval.tool).toLowerCase()}
          </span>
          <span className="flex-none text-[14px] text-faint tabular-nums">
            {time}
          </span>
        </p>
        {(approval.summary || auto) && (
          <p className="mt-0.5 flex min-w-0 items-center gap-2">
            {auto && (
              <span
                className="flex-none rounded-md border border-line px-1.5 text-[14px] leading-[20px] text-faint"
                title="Approved by the Auto-approve switch"
              >
                Auto
              </span>
            )}
            {approval.summary && (
              <span
                className="min-w-0 truncate font-mono text-[14px] text-dim"
                title={shortPaths(approval.summary)}
              >
                {shortPaths(approval.summary)}
              </span>
            )}
          </p>
        )}
        {approval.note && !auto && (
          <p className="mt-0.5 text-[14px] text-faint">“{approval.note}”</p>
        )}
      </div>
    </li>
  );
}
