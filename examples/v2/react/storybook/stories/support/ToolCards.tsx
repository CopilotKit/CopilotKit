import React from "react";
import { Calculator, Search } from "lucide-react";
import {
  defineToolCallRenderer,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

/**
 * Example app-defined tool renderers. They stand in for what a host app would
 * register via `renderToolCalls` / `useRenderTool`, so they use the host's
 * tokens rather than CopilotKit's.
 */

const StatusIndicator: React.FC<{ status: ToolCallStatus }> = ({ status }) => {
  const done = status === ToolCallStatus.Complete;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={
          done
            ? "size-1.5 rounded-full bg-foreground"
            : "size-1.5 animate-pulse rounded-full bg-muted-foreground"
        }
      />
      {done ? "Done" : "Running"}
    </span>
  );
};

const ToolCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  status: ToolCallStatus;
  children: React.ReactNode;
}> = ({ icon, title, status, children }) => (
  <div className="my-2 rounded-xl border border-border bg-card p-4 text-sm text-card-foreground">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 font-medium">
        <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        {title}
      </div>
      <StatusIndicator status={status} />
    </div>
    <div className="mt-3 space-y-2">{children}</div>
  </div>
);

const searchToolRenderer = defineToolCallRenderer({
  name: "search",
  args: z.object({
    query: z.string(),
    filters: z.array(z.string()).optional(),
  }),
  render: ({ args, status, result }) => (
    <ToolCard
      icon={<Search className="size-3.5" />}
      title="Search"
      status={status}
    >
      <p className="text-muted-foreground">
        Query: <span className="text-foreground">{args.query ?? "…"}</span>
      </p>
      {args.filters && args.filters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {args.filters.map((filter) => (
            <span
              key={filter}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {filter}
            </span>
          ))}
        </div>
      )}
      {status === ToolCallStatus.Complete && (
        <p className="border-t border-border pt-2 text-muted-foreground">
          {result}
        </p>
      )}
    </ToolCard>
  ),
});

const calculatorToolRenderer = defineToolCallRenderer({
  name: "calculator",
  args: z.object({ expression: z.string() }),
  render: ({ args, status, result }) => (
    <ToolCard
      icon={<Calculator className="size-3.5" />}
      title="Calculator"
      status={status}
    >
      <div className="flex items-baseline justify-between gap-4">
        <code className="font-mono text-muted-foreground">
          {args.expression ?? "…"}
        </code>
        <span className="text-lg font-semibold tabular-nums">
          {status === ToolCallStatus.Complete ? `= ${result}` : "…"}
        </span>
      </div>
    </ToolCard>
  ),
});

/** Stable renderer list for `parameters.copilotkit.provider.renderToolCalls`. */
export const demoToolRenderers = [searchToolRenderer, calculatorToolRenderer];
