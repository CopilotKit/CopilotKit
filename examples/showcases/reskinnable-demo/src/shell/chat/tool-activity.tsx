"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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

/**
 * Ordered ids of the tool activity currently mounted, oldest first.
 *
 * ## Why a shared registry and not something simpler
 *
 * CopilotKit renders ONE component per tool call and owns the container, so
 * there is no parent here that can see the list and slice it. Two simpler
 * options are both dead ends, measured on a real run:
 *
 *   - CSS (`:nth-last-child`) needs the lines to be siblings. They are not —
 *     ten lines sat under ten different parents, one wrapper each.
 *   - Mount-order counters drift, because a `MESSAGES_SNAPSHOT` at the end of a
 *     run remounts every line at once.
 *
 * So each line registers its AG-UI `toolCallId` — stable, unique per call, and
 * assigned in emission order — and reads back whether it is still among the
 * last few. `useSyncExternalStore` is what makes the OLDER lines re-render (and
 * so disappear) when a NEW one arrives; a plain module variable would leave
 * them on screen until something else happened to re-render them.
 */
const activityOrder: string[] = [];
const activityListeners = new Set<() => void>();

const subscribeActivity = (onChange: () => void) => {
  activityListeners.add(onChange);
  return () => {
    activityListeners.delete(onChange);
  };
};

const notifyActivityChanged = () => {
  for (const listener of activityListeners) listener();
};

/**
 * Whether this line is recent enough to still be shown.
 *
 * An id that is not registered YET counts as visible: registration happens in
 * an effect, so a line is not in the list during its own first render, and
 * treating that as hidden would make every new line appear one frame late.
 *
 * Unregistered-means-visible is only safe because registration is a LAYOUT
 * effect. Read this together with `useIsRecentToolActivity` — the two halves
 * are one mechanism, and splitting them is what caused the flash.
 */
const isRecentActivity = (toolCallId: string): boolean => {
  const index = activityOrder.indexOf(toolCallId);
  return index === -1 || index >= activityOrder.length - VISIBLE_TOOL_ACTIVITY;
};

/**
 * `useLayoutEffect`, except on the server where React warns that it does
 * nothing. Registration MUST be a layout effect (see below), and this component
 * is server-rendered as part of the chat, so the plain hook would log a warning
 * on every render pass in dev.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function useIsRecentToolActivity(toolCallId: string, track: boolean): boolean {
  /**
   * LAYOUT effect, not a passive one, and this is load-bearing.
   *
   * A new line renders visible before it is registered (it cannot know its own
   * position yet), and registering is what evicts the oldest line. With a
   * passive `useEffect` those two things land in different frames, so the
   * browser paints the in-between state: the list grows to three rows and then
   * snaps back to two. That is the flash — one extra row for one frame on every
   * single tool call, and again when the end-of-run `MESSAGES_SNAPSHOT`
   * remounts every line at once.
   *
   * React flushes state updates scheduled inside a layout effect before the
   * browser paints, so the eviction happens in the SAME frame as the insertion:
   * the painted row count goes 2 → 2 and never through 3.
   */
  useIsomorphicLayoutEffect(() => {
    // Internal tools must not take a slot: two filtered `agui` calls would
    // otherwise fill the window and blank out the real activity behind them.
    if (!track) return;
    if (!activityOrder.includes(toolCallId)) {
      activityOrder.push(toolCallId);
      notifyActivityChanged();
    }
    return () => {
      const index = activityOrder.indexOf(toolCallId);
      if (index === -1) return;
      activityOrder.splice(index, 1);
      notifyActivityChanged();
    };
  }, [toolCallId, track]);

  return useSyncExternalStore(
    subscribeActivity,
    () => isRecentActivity(toolCallId),
    // Server render: nothing has registered, so every line is "newest".
    () => true,
  );
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
  const recent = useIsRecentToolActivity(toolCallId, !hidden);

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
