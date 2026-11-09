"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ClipboardCheck,
  FilePen,
  GitBranch,
  Hourglass,
  Package,
  ShieldAlert,
  SquareTerminal,
  Zap,
} from "lucide-react";
import { taskLabel } from "@/lib/command-output";
import { diffLines, languageOf } from "@/lib/diff";
import { relativeToRepo } from "@/lib/use-workspace";
import { builtinArgs } from "@/lib/builtin-args";
import { DiffView } from "./diff-view";
import { shortPaths } from "@/lib/paths";

/** What the adapter puts on a `tool_approval` interrupt. */
export interface ApprovalRequest {
  tool: string;
  args: Record<string, unknown>;
  /** Interrupt metadata besides `tool_name` and `args`, if any. */
  meta?: Record<string, unknown>;
}

/** `auto` marks an answer given by the Auto-approve switch; the agent logs it. */
export type ApprovalAnswer =
  | { approved: true; auto?: true }
  | { approved: false; message?: string };

// Fields an interrupt or the model's arguments may use to say why a call is
// needed. Only text that is there is shown; nothing is made up.
const WHY_KEYS = [
  "explanation",
  "Explanation",
  "reason",
  "Reason",
  "why",
  "Why",
  "rationale",
  "Rationale",
  "justification",
  "Justification",
];

function whyOf(request: ApprovalRequest): string {
  for (const source of [request.meta ?? {}, request.args]) {
    for (const key of WHY_KEYS) {
      const value = source[key];
      if (typeof value === "string" && value.trim())
        return value.trim().replace(/\s+/g, " ");
    }
  }
  return "";
}

const s = (value: unknown): string => (typeof value === "string" ? value : "");

interface Described {
  icon: ReactNode;
  title: string;
  risk: string;
  body: ReactNode;
}

/**
 * A command line that wraps only between arguments. Browsers also break after
 * a hyphen, which splits flags like `--python` across lines; each argument is
 * kept whole, and only one longer than ~48 characters may break inside.
 */
function WrappedCommand({ line }: { line: string }) {
  return line.split(/(\s+)/).map((part, i) =>
    /^\s+$/.test(part) || part.length > 48 ? (
      part
    ) : (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ),
  );
}

function Command({ line: raw, cwd }: { line: string; cwd?: string }) {
  const line = shortPaths(raw);
  return (
    <div className="rounded-lg border border-line bg-bg/70 px-3 py-2.5 font-mono text-[15px] leading-relaxed">
      {cwd && cwd !== "." && (
        <p className="mb-1 text-[14px] text-faint">in {cwd}</p>
      )}
      <p className="wrap-code text-text/90">
        <span className="mr-2 select-none text-accent">$</span>
        <WrappedCommand line={line} />
      </p>
    </div>
  );
}

function EditPreview({
  args,
  repoPath,
}: {
  args: Record<string, unknown>;
  repoPath?: string;
}) {
  const path = relativeToRepo(builtinArgs.filePath(args), repoPath);
  const { before, after, startLine } = builtinArgs.edit(args);
  const hunks = useMemo(
    () => diffLines(before, after, startLine),
    [before, after, startLine],
  );
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <p className="truncate border-b border-line bg-tint-1 px-3 py-1.5 font-mono text-[14px] text-text/85">
        {path}
      </p>
      <DiffView
        hunks={hunks}
        lang={languageOf(path)}
        className="max-h-[300px] overflow-y-auto bg-bg/50"
      />
    </div>
  );
}

function describe(request: ApprovalRequest, repoPath?: string): Described {
  const { tool, args } = request;
  switch (tool) {
    case "install_dependencies":
      return {
        icon: <Package className="size-4" aria-hidden />,
        title: "Install dependencies",
        risk: "Downloads packages and runs their install steps in the workspace.",
        body: <Command line={s(args.command)} />,
      };
    case "run_check":
      return {
        icon: <ClipboardCheck className="size-4" aria-hidden />,
        title: "Run a check",
        risk: s(args.label)
          ? `Reproduces a CI step: ${s(args.label)}. Runs in the workspace, stops after 2 minutes.`
          : "Reproduces a CI step. Runs in the workspace, stops after 2 minutes.",
        body: <Command line={s(args.command)} />,
      };
    case "run_command":
      return {
        icon: <SquareTerminal className="size-4" aria-hidden />,
        title: "Run a shell command",
        risk: "Runs in the workspace with the agent's permissions.",
        body: (
          <Command
            line={builtinArgs.commandLine(args)}
            cwd={relativeToRepo(builtinArgs.cwd(args), repoPath)}
          />
        ),
      };
    case "edit_file":
      return {
        icon: <FilePen className="size-4" aria-hidden />,
        title: "Edit a file",
        risk: builtinArgs.description(args) || "Changes code in the workspace.",
        body: <EditPreview args={args} repoPath={repoPath} />,
      };
    case "git_push":
      return {
        icon: <GitBranch className="size-4" aria-hidden />,
        title: "Commit and push",
        risk: "Pushes to this demo's local remote. Nothing goes to GitHub.",
        body: (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-line bg-bg/70 px-3 py-2.5 text-[15.5px]">
            <dt className="text-faint">Branch</dt>
            <dd className="font-mono text-text/90">{s(args.branch)}</dd>
            <dt className="text-faint">Message</dt>
            <dd className="text-text/90">{s(args.commit_message)}</dd>
          </dl>
        ),
      };
    case "manage_task": {
      const action = s(args.Action ?? args.action).toLowerCase();
      const task = taskLabel(args.TaskId ?? args.task_id ?? args.task);
      const stopping = /kill|stop|cancel/.test(action);
      return {
        icon: <Hourglass className="size-4" aria-hidden />,
        title: stopping
          ? "Stop a background command"
          : "Check a background command",
        risk: stopping
          ? "Stops a command the agent started earlier. Its output so far is kept."
          : "Reads the status and output of a command the agent started earlier.",
        body: task ? (
          <p className="rounded-lg border border-line bg-bg/70 px-3 py-2.5 font-mono text-[15px] text-text/90">
            {task}
          </p>
        ) : null,
      };
    }
    default:
      return {
        icon: <ShieldAlert className="size-4" aria-hidden />,
        title: `Run ${tool}`,
        risk: "This tool can change the workspace.",
        body: (
          <pre className="wrap-code scroll-thin max-h-48 overflow-y-auto rounded-lg border border-line bg-bg/70 px-3 py-2.5 font-mono text-[14px] text-text/85">
            {JSON.stringify(args, null, 2)}
          </pre>
        ),
      };
  }
}

/** The approve/deny card for one risky tool call. */
export function ApprovalCard({
  request,
  repoPath,
  autoApprove = false,
  onAnswer,
}: {
  request: ApprovalRequest;
  repoPath?: string;
  /** Answer at once, without a click (the navbar's Auto-approve switch). */
  autoApprove?: boolean;
  onAnswer: (answer: ApprovalAnswer) => Promise<unknown>;
}) {
  const [sent, setSent] = useState<"approve" | "deny" | "auto" | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [autoFailed, setAutoFailed] = useState(false);
  const autoSent = useRef(false);
  const described = describe(request, repoPath);
  const why = whyOf(request);

  useEffect(() => {
    if (!autoApprove || sent || autoSent.current || autoFailed) return;
    autoSent.current = true;
    setSent("auto");
    onAnswer({ approved: true, auto: true }).catch((error: unknown) => {
      console.error("Could not send the automatic approval", error);
      autoSent.current = false;
      setSent(null);
      setAutoFailed(true);
    });
  }, [autoApprove, sent, autoFailed, onAnswer]);

  if (sent === "auto") {
    return (
      <section
        className="card enter w-full overflow-hidden"
        data-testid="approval-card"
        data-auto="true"
        data-chat-block="card"
        data-tool={request.tool}
      >
        <header className="flex items-center gap-3 px-4 pt-3">
          <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-inset ring-accent/25">
            <Zap className="size-4" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-tight">
            {described.title}
          </p>
          <span className="flex-none text-[14px] font-medium text-accent">
            Auto-approved
          </span>
        </header>
        {why && (
          <p className="px-4 pt-2 text-[15px] leading-relaxed text-dim">
            Why: {why}
          </p>
        )}
        <div className="px-4 pt-2.5 pb-3.5">{described.body}</div>
      </section>
    );
  }

  const answer = (kind: "approve" | "deny") => {
    if (sent) return;
    setSent(kind);
    const payload: ApprovalAnswer =
      kind === "approve"
        ? { approved: true }
        : { approved: false, ...(note.trim() ? { message: note.trim() } : {}) };
    onAnswer(payload).catch((error: unknown) => {
      console.error("Could not send the approval answer", error);
      setSent(null);
    });
  };

  return (
    <section
      className="card enter w-full overflow-hidden ring-1 ring-warn/20"
      data-testid="approval-card"
      data-chat-block="card"
      data-tool={request.tool}
    >
      <header className="flex items-start gap-3 px-4 pt-3.5">
        <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-warn/10 text-warn ring-1 ring-inset ring-warn/25">
          {described.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow text-warn/90">Needs your approval</p>
            <code className="font-mono text-[14px] text-faint">
              {request.tool}
            </code>
          </div>
          <p className="mt-0.5 text-[17px] font-semibold tracking-tight">
            {described.title}
          </p>
          <p className="mt-0.5 text-[15.5px] leading-relaxed text-dim">
            {described.risk}
          </p>
          {why && (
            <p className="mt-1 truncate text-[15px] text-text/85" title={why}>
              Why: {why}
            </p>
          )}
        </div>
      </header>

      {described.body && <div className="px-4 pt-3">{described.body}</div>}

      {noteOpen && !sent && (
        <div className="px-4 pt-3">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && answer("deny")}
            placeholder="Why not? Saved with the approval history."
            className="h-9 w-full rounded-lg border border-line bg-bg/70 px-3 text-[16px] text-text placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
        </div>
      )}

      <footer className="mt-3.5 flex items-center justify-between gap-3 border-t border-line bg-tint-1 px-4 py-2.5">
        <p className="text-[15px] text-faint">
          {sent === "approve"
            ? "Approved. Continuing."
            : sent === "deny"
              ? "Denied."
              : autoFailed
                ? "Auto-approve could not answer. Answer here."
                : "The agent is paused until you answer."}
        </p>
        <div className="flex items-center gap-2">
          {!noteOpen && !sent && (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="h-8 rounded-lg px-2.5 text-[15.5px] text-dim hover:text-text"
            >
              Add a note
            </button>
          )}
          <button
            type="button"
            disabled={sent !== null}
            onClick={() => answer("deny")}
            data-testid="approval-deny"
            className="h-8 rounded-lg border border-line-strong px-3 text-[15.5px] font-medium text-text/90 transition-colors hover:bg-tint-2 disabled:opacity-50"
          >
            Deny
          </button>
          <button
            type="button"
            disabled={sent !== null}
            onClick={() => answer("approve")}
            data-testid="approval-approve"
            className="h-8 rounded-lg bg-accent px-3.5 text-[15.5px] font-semibold text-accent-ink shadow-[inset_0_1px_0_oklch(1_0_0/25%)] transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      </footer>
    </section>
  );
}
