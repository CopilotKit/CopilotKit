"use client";

import { useMemo, useState } from "react";
import {
  defineToolCallRenderer,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import type { ReactToolCallRenderer } from "@copilotkit/react-core/v2";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";

/**
 * Tool calls that are plumbing, not activity. The AG-UI state-delta tool in
 * particular gets emitted with a `{op:"add", path:"/scratch", value:"noop"}`
 * payload as a keep-alive; surfacing it put raw protocol JSON in the middle of
 * the conversation. The wildcard renderer catches EVERY unhandled tool, so
 * anything internal has to be filtered here or it shows up on stage.
 *
 * These are PROTOCOL-LEVEL, so they live in the shell (not on a skin). A skin's
 * human-readable labels for its OWN tools come from `skin.toolLabels`.
 */
const HIDDEN_TOOL_PATTERNS = [
  /^agui/i,
  /sendstatedelta/i,
  /^a2ui/i,
  /^copilotkit_/i,
];

function isInternalTool(name: string): boolean {
  return HIDDEN_TOOL_PATTERNS.some((re) => re.test(name));
}

function prettifyToolName(name: string): string {
  const spaced = name
    // Drop MCP namespacing (e.g. "mcp__intelligence__recall_memory") so the
    // fallback label reads cleanly.
    .replace(/^mcp[_]+(intelligence[_]+)?/i, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Resolve the display label for a tool call from the active skin's toolLabels.
// Matches on `includes` so MCP-namespaced names (e.g.
// "mcp__intelligence__recall_memory") still map to the friendly label for
// "recall_memory". Preserves the pre-cutover lookup semantics exactly.
function resolveToolLabel(
  name: string,
  labels: Record<string, string> | undefined,
): string {
  if (labels) {
    for (const key of Object.keys(labels)) {
      if (name === key || name.includes(key)) return labels[key];
    }
  }
  return prettifyToolName(name);
}

/**
 * Tool activity for EVERY tool the agent calls — the wildcard ("*") tool-call
 * renderer. CopilotKit only falls back to this for tool calls with no exact
 * renderer of their own, so it surfaces the otherwise invisible ones
 * (recall_memory / save_memory, createReport, render_report, generateSandboxedUi)
 * while the charts and HITL cards keep their own rich renders. This is what
 * makes "show the tool calls" literally true.
 *
 * Styled like ChatGPT's activity lines rather than as a chip: borderless, one
 * small icon, muted sentence-case text on the conversation's own background;
 * while the call is in flight the label shimmers, then settles to a static line
 * with a check.
 */
function ToolCallChip({
  name,
  status,
  args,
  result,
}: {
  name: string;
  status: ToolCallStatus;
  args?: unknown;
  result?: string;
}) {
  const skin = useSkin();
  const [open, setOpen] = useState(false);
  const label = resolveToolLabel(name, skin.toolLabels);
  const done = status === ToolCallStatus.Complete;
  const hidden = isInternalTool(name);

  const detail = useMemo(() => {
    const lines: string[] = [`tool: ${name}`];
    if (args && Object.keys(args as object).length > 0) {
      lines.push(`input: ${JSON.stringify(args, null, 2)}`);
    }
    if (typeof result === "string" && result.trim()) {
      lines.push(`output: ${result}`);
    }
    return lines.join("\n");
  }, [name, args, result]);

  if (hidden) return <></>;

  return (
    <div data-testid="tool-activity" className="my-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded text-[0.8125rem] text-[#6e6e6e] transition-colors hover:text-[#0d0d0d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d0d0d] dark:text-[#b4b4b4] dark:hover:text-[#ececec] dark:focus-visible:ring-white"
      >
        {done ? (
          <Check className="h-3.5 w-3.5 flex-none" aria-hidden />
        ) : (
          <Loader2 className="h-3.5 w-3.5 flex-none animate-spin" aria-hidden />
        )}
        <span className={done ? undefined : "tool-activity-shimmer"}>
          {label}
        </span>
        {/* Chevron turns rather than swapping icons — same affordance ChatGPT
            uses (right when closed, down when open). */}
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 flex-none transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        // Indented with a hairline spine, the way ChatGPT nests the detail of an
        // activity under its summary.
        <pre className="ml-[0.4375rem] mt-1.5 overflow-x-auto border-l border-[#e3e3e3] pl-3 text-[0.6875rem] leading-relaxed text-[#6e6e6e] dark:border-white/15 dark:text-[#b4b4b4]">
          {detail}
        </pre>
      )}
    </div>
  );
}

// Module-level stable array — CopilotKitProvider requires a stable
// `renderToolCalls` reference across renders.
export const TOOL_CALL_RENDERERS: ReactToolCallRenderer<unknown>[] = [
  defineToolCallRenderer({
    name: "*",
    render: ({ name, status, args, result }) => (
      <ToolCallChip name={name} status={status} args={args} result={result} />
    ),
  }),
];
