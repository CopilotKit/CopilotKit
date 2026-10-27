import React, {
  createContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, ChevronRight, Circle, Loader2, X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { partialJSONParse } from "@copilotkit/shared";
import type { ToolCallEntry } from "./tool-call-layout";

export type CopilotChatToolCallGroupAppearance = "card" | "line" | "stack";

/** A call that never got a result after the run ended (Stop, an error) is "stopped". */
type CallStatus = "running" | "done" | "failed" | "stopped";

/**
 * Set by a group around the calls it shows, so CopilotKit's built-in tool card
 * draws itself as a compact row that fits the group instead of a card.
 * @internal
 */
export const ToolCallGroupContext = createContext<{
  appearance: "card" | "line" | "stack";
  failedIds: ReadonlySet<string>;
  /** The agent may still finish the group's calls; see `isActive`. */
  active: boolean;
} | null>(null);

/**
 * A call without a result is running only while the group is active: once
 * the run has moved on or ended, its result is never coming.
 */
const entryStatus = (
  { toolMessage }: ToolCallEntry,
  active: boolean,
): CallStatus =>
  toolMessage
    ? toolMessage.error
      ? "failed"
      : "done"
    : active
      ? "running"
      : "stopped";

/** @internal */
export const statusLabels: Record<CallStatus, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** The first non-empty string argument: usually a command, path or query. */
function argumentPreview(parameters: unknown): string | undefined {
  if (!parameters || typeof parameters !== "object") return undefined;
  const value = Object.values(parameters).find(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return value?.replace(/\s+/g, " ");
}

const entryPreview = (entry: ToolCallEntry) =>
  argumentPreview(partialJSONParse(entry.toolCall.function.arguments));

/** "run_command ×2, read_file" */
function toolNames(calls: ToolCallEntry[]): string {
  const counts = new Map<string, number>();
  for (const { toolCall } of calls) {
    const name = toolCall.function.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");
}

export const pluralize = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Height transition between closed and its content's height. Closed content
 * stays mounted (so its state survives) but is inert.
 * @internal
 */
export function Collapsible({
  open,
  id,
  className,
  children,
}: {
  open: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // React only treats `inert` as a prop from 19 on, so set the attribute
  // directly to keep closed content out of the tab order on React 18 too.
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.toggleAttribute("inert", !open);
  }, [open]);

  return (
    <div
      ref={ref}
      id={id}
      className={twMerge(
        "cpk:grid cpk:transition-[grid-template-rows] cpk:duration-300 cpk:ease-[cubic-bezier(0.16,1,0.3,1)] cpk:motion-reduce:transition-none",
        className,
      )}
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="cpk:min-h-0 cpk:overflow-hidden">{children}</div>
    </div>
  );
}

function StatusIcon({
  status,
  className,
}: {
  status: CallStatus;
  className?: string;
}) {
  const Icon = { running: Loader2, done: Check, failed: X, stopped: Circle }[
    status
  ];
  return (
    <Icon
      aria-hidden="true"
      className={twMerge(
        "cpk:size-3.5 cpk:shrink-0 cpk:text-muted-foreground",
        status === "running" && "cpk:animate-spin",
        status === "failed" && "cpk:text-destructive",
        className,
      )}
    />
  );
}

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={twMerge(
        "cpk:size-3.5 cpk:shrink-0 cpk:transition-transform cpk:duration-200",
        open && "cpk:rotate-90",
        className,
      )}
    />
  );
}

function FailedCount({ calls }: { calls: ToolCallEntry[] }) {
  const failed = calls.filter((call) => call.toolMessage?.error).length;
  if (!failed) return null;
  return (
    <span className="cpk:shrink-0 cpk:text-destructive">{failed} failed</span>
  );
}

/**
 * Guarded JSON.stringify for the payload blocks. A circular reference would
 * otherwise crash the entire React tree on render.
 */
function stringifyPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    console.warn(
      "[CopilotKit] Failed to JSON.stringify tool-call payload; falling back to String():",
      err,
    );
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="cpk:text-[11px] cpk:font-medium cpk:uppercase cpk:tracking-wide cpk:text-muted-foreground">
        {label}
      </div>
      <pre className="cpk:m-0 cpk:mt-1.5 cpk:max-h-[200px] cpk:overflow-auto cpk:rounded-lg cpk:bg-muted cpk:p-2.5 cpk:font-mono cpk:text-xs cpk:leading-relaxed cpk:text-foreground cpk:whitespace-pre-wrap cpk:break-words">
        {stringifyPayload(value)}
      </pre>
    </div>
  );
}

/**
 * A tool call's arguments and, once it has one, its result.
 * @internal
 */
export function ToolCallPayloads({
  parameters,
  result,
  className,
}: {
  parameters: unknown;
  result: string | undefined;
  className?: string;
}) {
  return (
    <div className={twMerge("cpk:grid cpk:gap-3", className)}>
      <Payload label="Arguments" value={parameters ?? {}} />
      {result !== undefined && <Payload label="Result" value={result} />}
    </div>
  );
}

/**
 * The built-in tool card drawn as a row inside a group: status, name and main
 * argument, opening to the payloads.
 * @internal
 */
export function ToolCallRow({
  name,
  parameters,
  result,
  status,
  appearance,
  className,
  ...props
}: {
  name: string;
  parameters: unknown;
  result: string | undefined;
  status: CallStatus;
  appearance: "card" | "line" | "stack";
} & React.HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const preview = argumentPreview(parameters);
  const line = appearance === "line";

  return (
    <div
      data-copilotkit
      // Rows draw their own divider: interaction capture can wrap each call
      // in a `display: contents` element, which a parent's divide-y misses.
      className={twMerge(
        appearance === "card" && "cpk:border-t cpk:border-border",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
        className={twMerge(
          "cpk:group/row cpk:m-0 cpk:flex cpk:min-w-0 cpk:cursor-pointer cpk:items-center cpk:gap-2 cpk:border-none cpk:bg-transparent cpk:text-left cpk:text-[13px] cpk:text-inherit cpk:transition-colors cpk:hover:bg-accent/60 cpk:focus-visible:outline-2 cpk:focus-visible:-outline-offset-2 cpk:focus-visible:outline-ring",
          line
            ? "cpk:-mx-1.5 cpk:w-[calc(100%+0.75rem)] cpk:rounded-md cpk:px-1.5 cpk:py-1"
            : appearance === "stack"
              ? "cpk:w-full cpk:px-3.5 cpk:py-2.5"
              : "cpk:w-full cpk:px-3.5 cpk:py-2",
        )}
      >
        <StatusIcon status={status} />
        <span
          data-testid="copilot-tool-render-name"
          className={twMerge(
            "cpk:shrink-0 cpk:font-mono cpk:text-[13px] cpk:font-medium cpk:text-foreground",
            status === "running" && "cpk-shimmer",
          )}
        >
          {name}
        </span>
        {preview && (
          <span className="cpk:min-w-0 cpk:truncate cpk:font-mono cpk:text-[13px] cpk:text-muted-foreground">
            {preview}
          </span>
        )}
        <span data-testid="copilot-tool-render-status" className="cpk:sr-only">
          {statusLabels[status]}
        </span>
        <Chevron
          open={open}
          className={twMerge(
            "cpk:ml-auto cpk:text-muted-foreground",
            !open &&
              "cpk:opacity-0 cpk:group-hover/row:opacity-100 cpk:group-focus-visible/row:opacity-100",
          )}
        />
      </button>
      <Collapsible open={open} id={detailsId}>
        <ToolCallPayloads
          parameters={parameters}
          result={result}
          className={
            line
              ? "cpk:mt-1 cpk:mb-2 cpk:ml-5.5"
              : "cpk:px-3.5 cpk:pt-1 cpk:pb-3"
          }
        />
      </Collapsible>
    </div>
  );
}

export interface CopilotChatToolCallGroupProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** The calls in the group, in order. */
  calls: ToolCallEntry[];
  /** Renders one call through the registered renderers. */
  renderCall: (call: ToolCallEntry) => React.ReactNode;
  /**
   * - `"card"` (default): one card with a summary header and a row per call.
   * - `"line"`: a quiet line of text that opens to a list of rows.
   * - `"stack"`: the latest call on a stack of the earlier ones.
   */
  appearance?: CopilotChatToolCallGroupAppearance;
  /** The agent is running and nothing follows the group, so more calls may join it. */
  isActive?: boolean;
}

/**
 * Tool calls made in a row, collapsed into one summary. While a call runs the
 * summary names it ("Running read_file  src/app.ts"); once they're all done it
 * reads "Used 3 tools" and opens to the calls.
 *
 * Each call is drawn by its registered renderer. CopilotKit's built-in card
 * (`useDefaultRenderTool`) draws a compact row inside the card and line
 * appearances and an open stack; a custom wildcard renderer draws whatever it
 * draws.
 */
export function CopilotChatToolCallGroup({
  calls,
  renderCall,
  appearance = "card",
  isActive = false,
  className,
  ...props
}: CopilotChatToolCallGroupProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const latest = calls[calls.length - 1];
  if (!latest) return null;

  // Only an active group has a call in progress. Between calls nothing is
  // running, so the latest call stays the subject (or the label flickers).
  const current = isActive
    ? (calls.find((call) => !call.toolMessage) ?? latest)
    : undefined;
  const preview = current ? entryPreview(current) : undefined;
  const done = calls.filter((call) => call.toolMessage).length;
  const statuses = calls.map((call) => entryStatus(call, isActive));
  const failedIds = new Set(
    calls
      .filter((_, index) => statuses[index] === "failed")
      .map((call) => call.toolCall.id),
  );
  const status: CallStatus = current
    ? "running"
    : failedIds.size > 0
      ? "failed"
      : statuses.includes("stopped")
        ? "stopped"
        : "done";

  const rows = (rowAppearance: "card" | "line") => (
    <ToolCallGroupContext.Provider
      value={{ appearance: rowAppearance, failedIds, active: isActive }}
    >
      {calls.map((call) => (
        <React.Fragment key={call.toolCall.id}>
          {renderCall(call)}
        </React.Fragment>
      ))}
    </ToolCallGroupContext.Provider>
  );

  const groupProps = {
    "data-copilotkit": true,
    "data-testid": "copilot-tool-call-group",
    "data-appearance": appearance,
    "data-state": status,
    ...props,
  };

  const runningLabel = current && (
    <>
      <span className="cpk:shrink-0 cpk:font-medium cpk-shimmer">
        Running {current.toolCall.function.name}
      </span>
      {preview && (
        <span className="cpk:min-w-0 cpk:truncate cpk:font-mono cpk:text-xs cpk:opacity-70">
          {preview}
        </span>
      )}
    </>
  );

  if (appearance === "line") {
    if (calls.length === 1 && !current) {
      return (
        <div {...groupProps} className={twMerge("cpk:my-2", className)}>
          <ToolCallGroupContext.Provider
            value={{ appearance: "line", failedIds, active: isActive }}
          >
            {renderCall(latest)}
          </ToolCallGroupContext.Provider>
        </div>
      );
    }
    return (
      <div {...groupProps} className={twMerge("cpk:my-3", className)}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="cpk:m-0 cpk:inline-flex cpk:max-w-full cpk:min-w-0 cpk:cursor-pointer cpk:items-center cpk:gap-1.5 cpk:rounded-md cpk:border-none cpk:bg-transparent cpk:p-0 cpk:py-0.5 cpk:text-sm cpk:text-muted-foreground cpk:transition-colors cpk:hover:text-foreground cpk:focus-visible:outline-2 cpk:focus-visible:outline-ring"
        >
          {runningLabel || (
            <>
              <span className="cpk:shrink-0 cpk:font-medium">
                Used {pluralize(calls.length, "tool")}
              </span>
              <span className="cpk:min-w-0 cpk:truncate cpk:font-mono cpk:text-xs cpk:opacity-70">
                {toolNames(calls)}
              </span>
              <FailedCount calls={calls} />
            </>
          )}
          <Chevron open={open} />
        </button>
        <Collapsible open={open} id={bodyId}>
          <div className="cpk:mt-1 cpk:ml-1 cpk:border-l-2 cpk:border-border cpk:py-0.5 cpk:pl-3">
            {rows("line")}
          </div>
        </Collapsible>
      </div>
    );
  }

  if (appearance === "stack") {
    // A lone call is the top card of a stack with nothing behind it yet.
    // One toggle in both states, so it keeps keyboard focus when pressed.
    const behind = open ? 0 : Math.min(calls.length - 1, 2);
    const layer =
      "cpk:rounded-xl cpk:border cpk:border-border cpk:bg-card cpk:text-card-foreground";
    const latestStatus = entryStatus(latest, isActive);
    const latestPreview = entryPreview(latest);
    return (
      <div
        {...groupProps}
        className={twMerge("cpk:my-3", className)}
        style={{ paddingBottom: behind * 6, ...props.style }}
      >
        <div className="cpk:relative cpk:isolate">
          {Array.from({ length: behind }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className={twMerge(layer, "cpk:absolute cpk:inset-0")}
              style={{
                transform: `translateY(${(index + 1) * 6}px) scaleX(${1 - (index + 1) * 0.045})`,
                zIndex: -1 - index,
                opacity: 1 - (index + 1) * 0.28,
              }}
            />
          ))}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={() => setOpen((value) => !value)}
            className={twMerge(
              "cpk:relative cpk:m-0 cpk:flex cpk:min-w-0 cpk:cursor-pointer cpk:items-center cpk:text-left cpk:transition-colors cpk:focus-visible:outline-2 cpk:focus-visible:outline-ring",
              open
                ? "cpk:mb-1.5 cpk:w-full cpk:gap-1.5 cpk:rounded-md cpk:border-none cpk:bg-transparent cpk:p-0 cpk:py-0.5 cpk:text-xs cpk:text-muted-foreground cpk:hover:text-foreground"
                : twMerge(
                    layer,
                    "cpk:w-full cpk:gap-2 cpk:px-3.5 cpk:py-2.5 cpk:text-[13px] cpk:shadow-[0_1px_2px_rgb(0_0_0/0.04)] cpk:hover:bg-accent",
                  ),
            )}
          >
            {open ? (
              <>
                {pluralize(calls.length, "tool call")}
                <FailedCount calls={calls} />
                <span className="cpk:ml-auto cpk:inline-flex cpk:items-center cpk:gap-1">
                  Collapse
                  <Chevron open className="cpk:-rotate-90" />
                </span>
              </>
            ) : (
              <>
                <span
                  key={latest.toolCall.id}
                  className="cpk:flex cpk:min-w-0 cpk:flex-1 cpk:items-center cpk:gap-2 cpk:animate-[cpk-stack-drop_260ms_cubic-bezier(0.16,1,0.3,1)] cpk:motion-reduce:animate-none"
                >
                  <StatusIcon status={latestStatus} />
                  <span
                    className={twMerge(
                      "cpk:shrink-0 cpk:font-mono cpk:font-medium cpk:text-foreground",
                      latestStatus === "running" && "cpk-shimmer",
                    )}
                  >
                    {latest.toolCall.function.name}
                  </span>
                  {latestPreview && (
                    <span className="cpk:min-w-0 cpk:truncate cpk:font-mono cpk:text-muted-foreground">
                      {latestPreview}
                    </span>
                  )}
                  {/* The status icon is decorative, so say the status. */}
                  <span className="cpk:sr-only">
                    {statusLabels[latestStatus]}
                  </span>
                </span>
                <span className="cpk:ml-2 cpk:inline-flex cpk:shrink-0 cpk:items-center cpk:gap-2 cpk:text-xs cpk:text-muted-foreground">
                  <FailedCount calls={calls} />
                  <span className="cpk:tabular-nums">
                    {pluralize(calls.length, "call")}
                  </span>
                  <Chevron open={false} className="cpk:rotate-90" />
                </span>
              </>
            )}
          </button>
        </div>
        {open && (
          // Each call gets the collapsed stack's card, easing out of the stack.
          <div id={bodyId} className="cpk:grid cpk:gap-1.5">
            <ToolCallGroupContext.Provider
              value={{ appearance: "stack", failedIds, active: isActive }}
            >
              {calls.map((call, index) => (
                <div
                  key={call.toolCall.id}
                  className={twMerge(
                    layer,
                    "cpk:overflow-hidden cpk:shadow-[0_1px_2px_rgb(0_0_0/0.04)] cpk:animate-[cpk-stack-fan_240ms_cubic-bezier(0.16,1,0.3,1)_both] cpk:motion-reduce:animate-none",
                  )}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  {renderCall(call)}
                </div>
              ))}
            </ToolCallGroupContext.Provider>
          </div>
        )}
      </div>
    );
  }

  // card: one call gets the same card as several, so the card a run starts
  // with doesn't change style when the next call joins it.
  return (
    <div
      {...groupProps}
      className={twMerge(
        "cpk:my-3 cpk:overflow-hidden cpk:rounded-xl cpk:border cpk:border-border cpk:bg-card cpk:text-card-foreground",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        className="cpk:m-0 cpk:flex cpk:w-full cpk:min-w-0 cpk:cursor-pointer cpk:items-center cpk:gap-2.5 cpk:border-none cpk:bg-transparent cpk:px-3.5 cpk:py-2.5 cpk:text-left cpk:text-[13px] cpk:text-inherit cpk:transition-colors cpk:hover:bg-accent/60 cpk:focus-visible:outline-2 cpk:focus-visible:-outline-offset-2 cpk:focus-visible:outline-ring"
      >
        <StatusIcon status={status} />
        {runningLabel || (
          <>
            <span className="cpk:shrink-0 cpk:font-medium cpk:text-foreground">
              Used {pluralize(calls.length, "tool")}
            </span>
            <span className="cpk:min-w-0 cpk:truncate cpk:font-mono cpk:text-xs cpk:text-muted-foreground">
              {toolNames(calls)}
            </span>
          </>
        )}
        <span className="cpk:ml-auto cpk:flex cpk:shrink-0 cpk:items-center cpk:gap-2 cpk:pl-2 cpk:text-xs cpk:text-muted-foreground">
          {status === "failed" ? (
            <FailedCount calls={calls} />
          ) : (
            <span className="cpk:tabular-nums">
              {status !== "running"
                ? statusLabels[status]
                : done > 0 && `${done} done`}
            </span>
          )}
          <Chevron open={open} />
        </span>
      </button>
      <Collapsible open={open} id={bodyId}>
        <div>{rows("card")}</div>
      </Collapsible>
    </div>
  );
}

export default CopilotChatToolCallGroup;
