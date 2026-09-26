"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  defineToolCallRenderer,
  ToolCallStatus,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import type { ReactToolCallRenderer } from "@copilotkit/react-core/v2";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { isInternalTool, selectRecentToolActivity } from "./tool-activity-recency";

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
 * How many tool-activity lines stay on screen. Older ones are REMOVED, not
 * collapsed or scrolled.
 *
 * The offsite-expenses beat emits ten to fourteen tool calls, and one line per
 * call turned the transcript into a changelog: the report card it all built
 * toward was pushed off the screen by a stack of finished `Execute` rows nobody
 * reads. A rolling window keeps the run legible as "what is happening now"
 * rather than "everything that has ever happened".
 */
const VISIBLE_TOOL_ACTIVITY = 2;

/** One conversation-owned window, shared by all mounted wildcard rows. */
const ToolActivityRecencyContext = createContext<ReadonlySet<string> | null>(null);

export function ToolActivityProvider({ children }: { children: ReactNode }) {
  const { agent } = useAgent({ updates: [] });
  const { copilotkit } = useCopilotKit();
  const subscribe = useCallback(
    (onChange: () => void) => {
      const messages = agent.subscribe({ onMessagesChanged: onChange });
      const renderers = copilotkit.subscribe({ onRenderToolCallsChanged: onChange });
      return () => {
        messages.unsubscribe();
        renderers.unsubscribe();
      };
    },
    [agent, copilotkit],
  );
  // A small value snapshot stays Object.is-equal while args/text stream. Read
  // the complete conversation, including rows the virtualizer never mounted.
  const getSnapshot = useCallback(
    () => JSON.stringify(selectRecentToolActivity(
      agent.messages, copilotkit.renderToolCalls, VISIBLE_TOOL_ACTIVITY,
    )),
    [agent, copilotkit],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "[]");
  const recent = useMemo(() => new Set<string>(JSON.parse(snapshot)), [snapshot]);

  return (
    <ToolActivityRecencyContext.Provider value={recent}>
      {children}
    </ToolActivityRecencyContext.Provider>
  );
}

function useIsRecentToolActivity(toolCallId: string): boolean {
  const recent = useContext(ToolActivityRecencyContext);
  if (!recent) {
    throw new Error("Tool activity renderers require ToolActivityProvider");
  }
  return recent.has(toolCallId);
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
  toolCallId,
  name,
  status,
  args,
  result,
}: {
  toolCallId: string;
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
  const recent = useIsRecentToolActivity(toolCallId);

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
  // Aged out of the window. Returning nothing REMOVES the line rather than
  // hiding it, which is the point: the transcript should not keep growing a
  // stack of finished steps behind the thing they produced. The full sequence
  // is still in the run's own events (and the harness console renders them).
  if (!recent) return <></>;

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
    render: ({ toolCallId, name, status, args, result }) => (
      <ToolCallChip
        toolCallId={toolCallId}
        name={name}
        status={status}
        args={args}
        result={result}
      />
    ),
  }),
];
