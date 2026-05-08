"use client";

/**
 * ToolCallView — generic catch-all renderer for tool calls.
 *
 * Mounted at the CopilotKit provider via:
 *   renderToolCalls={[{ name: "*", render: ToolCallView }]}
 *
 * Shows a tight, low-noise card per tool invocation in the chat. Tools
 * that have their own dedicated `useFrontendTool({ render })` slot (e.g.
 * renderEnrichmentStream, renderEmailDraft) skip this view — CopilotKit's
 * resolver prefers exact-name matches over the "*" wildcard.
 *
 * Three visual states keyed off `status` (from CopilotKit):
 *
 *   InProgress  — args still streaming in. Spinner dot + "calling X".
 *   Executing   — args complete, tool running. Same dot, busier label.
 *   Complete    — has `result`. Green check + summary; click to expand.
 *
 * The expand control reveals the full args object + result. JSON-shaped
 * results are pretty-printed; plain strings shown verbatim.
 */

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { ToolCallStatus } from "@copilotkit/core";

// CopilotKit passes status as the `ToolCallStatus` enum (string values
// "inProgress" / "executing" / "complete"). Re-exporting the enum keeps
// the type alignment one import away for callers.
export { ToolCallStatus };

export interface ToolCallViewProps {
  name: string;
  toolCallId: string;
  args: unknown;
  status: ToolCallStatus;
  /** Tool result content as returned by the agent. Often a JSON string. */
  result?: string;
}

export function ToolCallView({
  name,
  args,
  status,
  result,
}: ToolCallViewProps) {
  const [expanded, setExpanded] = useState(false);

  const summary = useResultSummary(result, status);
  const argsString = useArgsPreview(args);
  const isLive =
    status === ToolCallStatus.InProgress || status === ToolCallStatus.Executing;

  return (
    <div
      data-tool-status={status}
      className="my-1.5 max-w-[400px] rounded-lg border border-border bg-card/60 text-[11px]"
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        aria-expanded={expanded}
      >
        <StatusDot status={status} />
        <code className="truncate font-mono text-[11px] text-foreground">
          {name}
        </code>
        <span className="ml-auto truncate text-[10px] text-muted-foreground">
          {summary}
        </span>
        {expanded ? (
          <ChevronDown
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground"
          />
        )}
      </button>

      {/* Expanded details — args + result */}
      {expanded ? (
        <div className="border-t border-border/60 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-foreground/85">
          {argsString ? (
            <DetailBlock label="args">{argsString}</DetailBlock>
          ) : null}
          {result ? (
            <DetailBlock label="result">{prettyResult(result)}</DetailBlock>
          ) : isLive ? (
            <div className="text-muted-foreground italic">
              awaiting result…
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: ToolCallStatus }) {
  if (status === ToolCallStatus.Complete) {
    return (
      <span
        aria-label="Complete"
        className="grid size-3.5 shrink-0 place-items-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30"
      >
        <Check className="size-2.5 text-emerald-600 dark:text-emerald-400" />
      </span>
    );
  }
  return (
    <span
      aria-label={status === ToolCallStatus.Executing ? "Executing" : "In progress"}
      className="grid size-3.5 shrink-0 place-items-center rounded-full bg-secondary/15 ring-1 ring-secondary/30"
    >
      <Loader2 className="size-2.5 animate-spin text-secondary" />
    </span>
  );
}

function DetailBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-48 overflow-auto rounded bg-muted/40 p-1.5 text-[10px] whitespace-pre-wrap break-words">
        {children}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

/**
 * Pull a short, human-readable headline out of a tool result.
 * - `null` while still in flight (so caller hides the slot)
 * - "running…" / "calling…" while the agent works
 * - JSON results: try common keys ("rows" array length, "row_count", first
 *   string property) before falling back to a length-bounded preview
 * - String results: trimmed preview
 */
function useResultSummary(
  result: string | undefined,
  status: ToolCallStatus,
): string {
  if (status === ToolCallStatus.InProgress) return "calling…";
  if (status === ToolCallStatus.Executing) return "running…";
  if (!result) return "completed";

  // Try JSON first
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === "object") {
      // Common patterns used by our backend tools
      if (Array.isArray(parsed)) return `${parsed.length} items`;
      if (Array.isArray((parsed as { rows?: unknown[] }).rows)) {
        const n = (parsed as { rows: unknown[] }).rows.length;
        return `${n} rows`;
      }
      if (typeof (parsed as { row_count?: number }).row_count === "number") {
        return `${(parsed as { row_count: number }).row_count} rows`;
      }
      if (typeof (parsed as { warning?: string }).warning === "string") {
        return "warning ⚠";
      }
      if (typeof (parsed as { error?: string }).error === "string") {
        return "error";
      }
      // Take the first scalar value as a hint
      const firstScalar = Object.entries(parsed).find(
        ([, v]) =>
          typeof v === "string" || typeof v === "number" || typeof v === "boolean",
      );
      if (firstScalar) {
        const [k, v] = firstScalar;
        return truncate(`${k}: ${String(v)}`, 32);
      }
      return "ok";
    }
  } catch {
    // Not JSON — fall through to string preview
  }

  return truncate(result.replace(/\s+/g, " ").trim(), 40);
}

function useArgsPreview(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return args;
  try {
    const json = JSON.stringify(args, null, 2);
    return json.length > 4000 ? json.slice(0, 4000) + "\n… (truncated)" : json;
  } catch {
    return String(args);
  }
}

function prettyResult(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
