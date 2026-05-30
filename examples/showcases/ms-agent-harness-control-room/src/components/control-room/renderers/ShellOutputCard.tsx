"use client";

/**
 * Card rendered for shell tool calls, including the Harness-gated `pnpm_run`
 * function used by the stage fixture.
 *
 * The Control Room agent's shell-execution path is a *live wrapper*: the
 * agent gates `pnpm_run` behind Harness's ToolApproval primitive and runs the
 * resolved command in the fixture sandbox. That wrapper status is surfaced via the
 * `<PrimitiveWrapperBadge />`.
 */

import { CodeBlock } from "@/components/control-room/renderers/CodeBlock";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CommandExecutionResult } from "@/lib/control-room-types";

interface ShellOutputCardProps {
  args?: { command?: string; command_name?: string; approval_token?: string };
  status?: string;
  result?: CommandExecutionResult & {
    exitCode?: number;
    timedOut?: boolean;
    stdout?: string;
    stderr?: string;
  };
}

const TRUNCATION_MARKER = "[truncated to 12000 chars]";

export function ShellOutputCard({
  args,
  status,
  result,
}: ShellOutputCardProps) {
  // Hide the card while the underlying tool is still in flight. The approval
  // card is the important presenter moment; a second "waiting" shell card
  // makes the gate look like two independent steps.
  if (!result && status !== "complete") {
    return null;
  }

  const commandLabel =
    args?.command ?? args?.command_name ?? result?.command ?? "shell command";
  const exitCode = result?.exit_code ?? result?.exitCode;
  const timedOut = result?.timed_out ?? result?.timedOut ?? false;
  const stdout = result?.stdout ?? "";
  const stderr = result?.stderr ?? "";
  const showTruncation =
    stdout.includes(TRUNCATION_MARKER) || stderr.includes(TRUNCATION_MARKER);

  return (
    <Card
      size="sm"
      className="my-3 max-w-3xl rounded-xl py-4 shadow-none ring-border"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto text-sm">
            Shell · {commandLabel}
          </CardTitle>
          <StatusBadge
            status={status}
            success={result?.success ?? exitCode === 0}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Exit code</dt>
          <dd>{exitCode == null ? "—" : exitCode}</dd>
          <dt className="text-muted-foreground">Timed out</dt>
          <dd>{timedOut ? "yes" : "no"}</dd>
        </dl>
        {showTruncation && (
          <Badge variant="secondary" className="w-fit">
            Output truncated to 12000 chars by the live wrapper
          </Badge>
        )}
        {stdout.length > 0 && <OutputBlock label="stdout" body={stdout} />}
        {stderr.length > 0 && (
          <OutputBlock label="stderr" body={stderr} tone="error" />
        )}
      </CardContent>
    </Card>
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
    <Badge
      variant="outline"
      className={
        tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : tone === "red"
            ? "border-red-200 bg-red-50 text-red-700"
            : tone === "amber"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : undefined
      }
    >
      {label}
    </Badge>
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
    <section className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <CodeBlock
        code={body}
        language="bash"
        maxHeight={220}
        className={tone === "error" ? "border-[var(--cr-red)]" : ""}
      />
    </section>
  );
}
