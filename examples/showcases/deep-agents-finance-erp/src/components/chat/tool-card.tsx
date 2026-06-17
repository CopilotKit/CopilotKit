"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  Search,
  TrendingUp,
  ArrowRight,
  LayoutDashboard,
  Settings,
  BarChart3,
  ShieldCheck,
  Loader2,
  type LucideIcon,
} from "lucide-react";

/**
 * ToolCard — Generative UI for tool call rendering in the finance-erp chat.
 *
 * Adapted from deep-agents/src/components/ToolCard.tsx but uses the
 * finance-erp Tailwind design system (bg-card, text-muted-foreground, etc.)
 * instead of CSS custom properties.
 */

interface ToolCardProps {
  name: string;
  status: "inProgress" | "executing" | "complete";
  args: Record<string, unknown>;
  result?: unknown;
}

// ---------------------------------------------------------------------------
// Tool configuration map
// ---------------------------------------------------------------------------

const TOOL_CONFIG: Record<
  string,
  {
    icon: LucideIcon;
    getDisplayText: (args: Record<string, unknown>) => string;
    getResultSummary?: (
      result: unknown,
      args: Record<string, unknown>,
    ) => string | null;
  }
> = {
  do_research: {
    icon: Search,
    getDisplayText: (args) => {
      const q = (args.query as string) || "...";
      return `Researching: ${q.slice(0, 60)}${q.length > 60 ? "..." : ""}`;
    },
    getResultSummary: () => "Completed data gathering",
  },
  do_projections: {
    icon: TrendingUp,
    getDisplayText: (args) => {
      const q = (args.query as string) || "...";
      return `Projecting: ${q.slice(0, 60)}${q.length > 60 ? "..." : ""}`;
    },
    getResultSummary: () => "Completed projections",
  },
  navigate_and_filter: {
    icon: ArrowRight,
    getDisplayText: (args) =>
      `Navigating to ${args.page || "page"}${args.filter ? ` (${args.filter})` : ""}`,
  },
  update_dashboard: {
    icon: LayoutDashboard,
    getDisplayText: (args) => {
      const widgets = args.widgets as Array<{ type: string }> | undefined;
      if (widgets?.length) {
        const types = widgets.map((w) => w.type).join(", ");
        return `Adding widgets: ${types}`;
      }
      return "Updating dashboard...";
    },
    getResultSummary: (result) =>
      typeof result === "string" ? result : "Dashboard updated",
  },
  manage_dashboard: {
    icon: Settings,
    getDisplayText: (args) => {
      if (args.action === "reset") return "Resetting dashboard to defaults";
      if (args.action === "remove")
        return `Removing widget ${args.widgetId || ""}`;
      if (args.action === "reorder") return "Reordering dashboard layout";
      return `Dashboard: ${args.action || "managing"}`;
    },
    getResultSummary: (result) =>
      typeof result === "string" ? result : "Layout updated",
  },
  render_chat_visual: {
    icon: BarChart3,
    getDisplayText: (args) =>
      args.type === "cash_position"
        ? "Showing cash position"
        : `Chart: ${(args.title as string) || "..."}`,
  },
  request_approval: {
    icon: ShieldCheck,
    getDisplayText: (args) =>
      args.type === "inventory_reorder"
        ? "Requesting inventory reorder approval"
        : "Requesting invoice payment approval",
  },
};

// ---------------------------------------------------------------------------
// ToolCard (entry point)
// ---------------------------------------------------------------------------

export function ToolCard({ name, status, args, result }: ToolCardProps) {
  const config = TOOL_CONFIG[name];
  if (config) {
    return (
      <SpecializedToolCard
        name={name}
        status={status}
        args={args}
        result={result}
        config={config}
      />
    );
  }
  return (
    <DefaultToolCard name={name} status={status} args={args} result={result} />
  );
}

/**
 * Compact variant used by hooks that render their own rich UI on
 * inProgress but want a persistent completion indicator in chat.
 */
export function CompletedToolCard({
  name,
  args,
  result,
}: {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}) {
  return <ToolCard name={name} status="complete" args={args} result={result} />;
}

// ---------------------------------------------------------------------------
// SpecializedToolCard
// ---------------------------------------------------------------------------

interface SpecializedToolCardProps extends ToolCardProps {
  config: (typeof TOOL_CONFIG)[string];
}

function SpecializedToolCard({
  name,
  status,
  args,
  result,
  config,
}: SpecializedToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = status === "complete";
  const isExecuting = status === "inProgress" || status === "executing";

  const resultSummary =
    isComplete && config.getResultSummary
      ? config.getResultSummary(result, args)
      : null;

  // Only do_research and do_projections have expandable content
  const hasExpandableContent =
    isComplete && (name === "do_research" || name === "do_projections");

  return (
    <div
      className={`animate-in fade-in slide-in-from-bottom-2 rounded-lg border border-border bg-card p-3 my-2 transition-all duration-300 ease-out ${
        isComplete ? "opacity-80" : ""
      } ${hasExpandableContent ? "cursor-pointer" : ""}`}
      onClick={hasExpandableContent ? () => setExpanded(!expanded) : undefined}
    >
      <div className="flex items-center gap-3">
        {/* Status icon */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            isComplete ? "bg-green-500/10" : "bg-amber-500/10"
          }`}
        >
          {isComplete ? (
            <Check size={16} strokeWidth={2} className="text-green-600" />
          ) : (
            <config.icon
              size={16}
              strokeWidth={2}
              className={`text-amber-600 ${isExecuting ? "animate-spin" : ""}`}
            />
          )}
        </div>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium ${
              isComplete ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {config.getDisplayText(args)}
          </p>
          {resultSummary && (
            <p className="mt-0.5 text-xs text-green-600">{resultSummary}</p>
          )}
        </div>

        {/* Expand chevron */}
        {hasExpandableContent && (
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        )}

        {/* Spinner for long-running tools */}
        {isExecuting &&
          (name === "do_research" || name === "do_projections") && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
      </div>

      {/* Expanded details */}
      {expanded && isComplete && (
        <div className="mt-3 border-t border-border pt-3">
          <ExpandedDetails name={name} result={result} args={args} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExpandedDetails
// ---------------------------------------------------------------------------

function ExpandedDetails({
  name,
  result,
  args,
}: {
  name: string;
  result: unknown;
  args: Record<string, unknown>;
}) {
  if (name === "do_research" || name === "do_projections") {
    const text = typeof result === "string" ? result : "";
    if (!text)
      return <p className="text-xs text-muted-foreground">No findings</p>;
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Query:</p>
        <p className="text-xs text-foreground/70">
          {(args.query as string) || "..."}
        </p>
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          Findings:
        </p>
        <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>
      </div>
    );
  }

  // Fallback: JSON display
  return (
    <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
      {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// DefaultToolCard (fallback for unknown tools)
// ---------------------------------------------------------------------------

function DefaultToolCard({ name, status, args, result }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = status === "complete";

  return (
    <div className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-lg border border-border bg-card p-3 duration-300 ease-out">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg ${
              isComplete ? "bg-green-500/10" : "bg-purple-500/10"
            }`}
          >
            {isComplete ? (
              <Check size={16} className="text-green-600" />
            ) : (
              <Loader2 size={16} className="animate-spin text-purple-600" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <code className="text-sm text-foreground">{name}</code>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                isComplete
                  ? "bg-green-500/10 text-green-700"
                  : "bg-purple-500/10 text-purple-700"
              }`}
            >
              {status}
            </span>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Arguments:</p>
            <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {result !== undefined && result !== null && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Result:</p>
              <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
