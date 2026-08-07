"use client";

/**
 * Card rendered for `command_run_registered` tool calls.
 *
 * The Control Room agent's shell-execution path is a *live wrapper*: the
 * agent gates `shell.execute` behind an approval primitive and runs the
 * resolved command on the host. That wrapper status is surfaced via the
 * `<PrimitiveWrapperBadge />`.
 */

import { PrimitiveWrapperBadge } from "@/components/control-room/PrimitiveWrapperBadge";
import { CodeBlock } from "@/components/control-room/renderers/CodeBlock";
import type { CommandExecutionResult } from "@/lib/control-room-types";

interface ShellOutputCardProps {
  args?: { command_name?: string; approval_token?: string };
  status?: string;
  result?: CommandExecutionResult;
}

const TRUNCATION_MARKER = "[truncated to 12000 chars]";

export function ShellOutputCard({
  args,
  status,
  result,
}: ShellOutputCardProps) {
  // Hide the card while the underlying tool is still in flight — at this point
  // the matching command_request_approval card is what the user should be
  // focused on. Rendering a "waiting" placeholder here just looks like a second
  // step is independently progressing, which confuses the approval gate.
  if (!result && status !== "complete") {
    return null;
  }

  const commandLabel = args?.command_name ?? result?.command ?? "shell command";
  const exitCode = result?.exit_code;
  const timedOut = result?.timed_out ?? false;
  const stdout = result?.stdout ?? "";
  const stderr = result?.stderr ?? "";
  const showTruncation =
    stdout.includes(TRUNCATION_MARKER) || stderr.includes(TRUNCATION_MARKER);

  return (
    <div className="cr-tool-card">
      <header className="cr-tool-card__header">
        <h3 className="cr-tool-card__title">Shell · {commandLabel}</h3>
        <StatusBadge status={status} success={result?.success} />
        <PrimitiveWrapperBadge />
      </header>
      <dl className="cr-dl">
        <dt>Exit code</dt>
        <dd>{exitCode == null ? "—" : exitCode}</dd>
        <dt>Timed out</dt>
        <dd>{timedOut ? "yes" : "no"}</dd>
      </dl>
      {showTruncation && (
        <p
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-amber)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Output truncated to 12000 chars by the live wrapper.
        </p>
      )}
      {stdout.length > 0 && <OutputBlock label="stdout" body={stdout} />}
      {stderr.length > 0 && (
        <OutputBlock label="stderr" body={stderr} tone="error" />
      )}
    </div>
  );
}

function StatusBadge({
  status,
  success,
}: {
  status?: string;
  success?: boolean;
}) {
  const label =
    status === "complete"
      ? success === false
        ? "failed"
        : "ok"
      : status === "executing"
        ? "running"
        : (status ?? "pending");
  const tone =
    label === "ok"
      ? "emerald"
      : label === "failed"
        ? "red"
        : label === "running"
          ? "amber"
          : undefined;
  return (
    <span className="cr-chip" data-tone={tone}>
      {label}
    </span>
  );
}

function OutputBlock({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone?: "error";
}) {
  return (
    <section className="cr-tool-card__section">
      <div className="cr-tool-card__label">{label}</div>
      <CodeBlock
        code={body}
        language="bash"
        maxHeight={220}
        className={tone === "error" ? "border-[var(--cr-red)]" : ""}
      />
    </section>
  );
}
