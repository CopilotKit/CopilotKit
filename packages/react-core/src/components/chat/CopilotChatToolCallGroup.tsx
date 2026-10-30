import React, {
  createContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, ChevronRight, Circle, Loader2, X } from "lucide-react";
import {
  CopilotChatDefaultLabels,
  ɵcountFailedToolCalls,
  ɵformatLabel,
  ɵformatToolNames,
  ɵgetArgumentPreview,
  ɵgetToolCallPreview,
  ɵgetToolCallRowStatus,
  ɵstringifyToolCallPayload,
} from "@copilotkit/core";
import type {
  CopilotChatLabels,
  ToolCallEntry,
  ɵToolCallRowStatus,
} from "@copilotkit/core";
import { cn } from "../../lib/utils";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { formatCountLabel } from "./format-count-label";

export type CopilotChatToolCallGroupAppearance = "card" | "line" | "stack";

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

/** The label key for each call status. */
const STATUS_LABEL_KEYS = {
  running: "toolCallStatusRunningLabel",
  done: "toolCallStatusDoneLabel",
  failed: "toolCallStatusFailedLabel",
  stopped: "toolCallStatusStoppedLabel",
} satisfies Record<ɵToolCallRowStatus, keyof CopilotChatLabels>;

/** The chat labels from the nearest chat configuration, or the defaults. */
function useLabels() {
  const config = useCopilotChatConfiguration();
  return config?.labels ?? CopilotChatDefaultLabels;
}

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
      className={cn("cpk-collapsible", className)}
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="cpk-collapsible-content">{children}</div>
    </div>
  );
}

function StatusIcon({
  status,
  className,
}: {
  status: ɵToolCallRowStatus;
  className?: string;
}) {
  const Icon = { running: Loader2, done: Check, failed: X, stopped: Circle }[
    status
  ];
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "cpk-tool-call-status-icon",
        status === "running" && "cpk-tool-call-status-icon-running",
        status === "failed" && "cpk-tool-call-status-icon-failed",
        className,
      )}
    />
  );
}

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn(
        "cpk-tool-call-chevron",
        open && "cpk-tool-call-chevron-open",
        className,
      )}
    />
  );
}

function FailedCount({ calls }: { calls: ToolCallEntry[] }) {
  const labels = useLabels();
  const failed = ɵcountFailedToolCalls(calls);
  if (!failed) return null;
  return (
    <span className="cpk-tool-call-failed-count">
      {ɵformatLabel(labels.toolCallFailedCountLabel, { count: failed })}
    </span>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="cpk-tool-call-payload-label">{label}</div>
      <pre className="cpk-tool-call-payload-code">
        {ɵstringifyToolCallPayload(value)}
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
  const labels = useLabels();
  return (
    <div className={cn("cpk-tool-call-payloads", className)}>
      <Payload label={labels.toolCallArgumentsLabel} value={parameters ?? {}} />
      {result !== undefined && (
        <Payload label={labels.toolCallResultLabel} value={result} />
      )}
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
  status: ɵToolCallRowStatus;
  appearance: "card" | "line" | "stack";
} & React.HTMLAttributes<HTMLDivElement>) {
  const labels = useLabels();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const preview = ɵgetArgumentPreview(parameters);

  return (
    <div
      data-copilotkit
      // Rows draw their own divider: interaction capture can wrap each call
      // in a `display: contents` element, which a parent's divide-y misses.
      className={cn(
        "cpk-tool-call-row",
        `cpk-tool-call-row-${appearance}`,
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
        className="cpk-tool-call-row-button"
      >
        <StatusIcon status={status} />
        <span
          data-testid="copilot-tool-render-name"
          className={cn(
            "cpk-tool-call-row-name",
            status === "running" && "cpk-shimmer",
          )}
        >
          {name}
        </span>
        {preview && (
          <span className="cpk-tool-call-row-preview">{preview}</span>
        )}
        <span
          data-testid="copilot-tool-render-status"
          className="cpk-tool-call-row-status"
        >
          {labels[STATUS_LABEL_KEYS[status]]}
        </span>
        <Chevron open={open} className="cpk-tool-call-row-chevron" />
      </button>
      <Collapsible open={open} id={detailsId}>
        <ToolCallPayloads
          parameters={parameters}
          result={result}
          className="cpk-tool-call-row-payloads"
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
  const labels = useLabels();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const latest = calls[calls.length - 1];
  if (!latest) return null;

  // Only an active group has a call in progress. Between calls nothing is
  // running, so the latest call stays the subject (or the label flickers).
  const current = isActive
    ? (calls.find((call) => !call.toolMessage) ?? latest)
    : undefined;
  const preview = current ? ɵgetToolCallPreview(current) : undefined;
  const done = calls.filter((call) => call.toolMessage).length;
  const statuses = calls.map((call) => ɵgetToolCallRowStatus(call, isActive));
  const failedIds = new Set(
    calls
      .filter((_, index) => statuses[index] === "failed")
      .map((call) => call.toolCall.id),
  );
  const status: ɵToolCallRowStatus = current
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
      <span className="cpk-tool-call-group-running cpk-shimmer">
        {ɵformatLabel(labels.toolCallRunningLabel, {
          name: current.toolCall.function.name,
        })}
      </span>
      {preview && (
        <span className="cpk-tool-call-group-preview">{preview}</span>
      )}
    </>
  );

  if (appearance === "line") {
    if (calls.length === 1 && !current) {
      return (
        <div
          {...groupProps}
          className={cn(
            "cpk-tool-call-group cpk-tool-call-group-line cpk-tool-call-group-single",
            className,
          )}
        >
          <ToolCallGroupContext.Provider
            value={{ appearance: "line", failedIds, active: isActive }}
          >
            {renderCall(latest)}
          </ToolCallGroupContext.Provider>
        </div>
      );
    }
    return (
      <div
        {...groupProps}
        className={cn(
          "cpk-tool-call-group cpk-tool-call-group-line",
          className,
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="cpk-tool-call-group-line-toggle"
        >
          {runningLabel || (
            <>
              <span className="cpk-tool-call-group-line-summary">
                {formatCountLabel(calls.length, {
                  one: labels.toolCallUsedToolsOne,
                  other: labels.toolCallUsedToolsOther,
                })}
              </span>
              <span className="cpk-tool-call-group-line-names">
                {ɵformatToolNames(calls)}
              </span>
              <FailedCount calls={calls} />
            </>
          )}
          <Chevron open={open} />
        </button>
        <Collapsible open={open} id={bodyId}>
          <div className="cpk-tool-call-group-line-body">{rows("line")}</div>
        </Collapsible>
      </div>
    );
  }

  if (appearance === "stack") {
    // A lone call is the top card of a stack with nothing behind it yet.
    // One toggle in both states, so it keeps keyboard focus when pressed.
    const behind = open ? 0 : Math.min(calls.length - 1, 2);
    const layer = "cpk-tool-call-group-stack-layer";
    const latestStatus = ɵgetToolCallRowStatus(latest, isActive);
    const latestPreview = ɵgetToolCallPreview(latest);
    return (
      <div
        {...groupProps}
        className={cn(
          "cpk-tool-call-group cpk-tool-call-group-stack",
          className,
        )}
        style={{ paddingBottom: behind * 6, ...props.style }}
      >
        <div className="cpk-tool-call-group-stack-pile">
          {Array.from({ length: behind }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className={cn(layer, "cpk-tool-call-group-stack-behind")}
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
            className={cn(
              "cpk-tool-call-group-stack-toggle",
              open
                ? "cpk-tool-call-group-stack-toggle-open"
                : [layer, "cpk-tool-call-group-stack-toggle-closed"],
            )}
          >
            {open ? (
              <>
                {formatCountLabel(calls.length, {
                  one: labels.toolCallToolCallCountOne,
                  other: labels.toolCallToolCallCountOther,
                })}
                <FailedCount calls={calls} />
                <span className="cpk-tool-call-group-stack-collapse">
                  {labels.toolCallCollapseLabel}
                  <Chevron
                    open
                    className="cpk-tool-call-group-stack-collapse-icon"
                  />
                </span>
              </>
            ) : (
              <>
                <span
                  key={latest.toolCall.id}
                  className="cpk-tool-call-group-stack-latest"
                >
                  <StatusIcon status={latestStatus} />
                  <span
                    className={cn(
                      "cpk-tool-call-group-stack-name",
                      latestStatus === "running" && "cpk-shimmer",
                    )}
                  >
                    {latest.toolCall.function.name}
                  </span>
                  {latestPreview && (
                    <span className="cpk-tool-call-group-stack-preview">
                      {latestPreview}
                    </span>
                  )}
                  {/* The status icon is decorative, so say the status. */}
                  <span className="cpk-tool-call-group-stack-status">
                    {labels[STATUS_LABEL_KEYS[latestStatus]]}
                  </span>
                </span>
                <span className="cpk-tool-call-group-stack-meta">
                  <FailedCount calls={calls} />
                  <span className="cpk-tool-call-group-stack-count">
                    {formatCountLabel(calls.length, {
                      one: labels.toolCallCallCountOne,
                      other: labels.toolCallCallCountOther,
                    })}
                  </span>
                  <Chevron
                    open={false}
                    className="cpk-tool-call-group-stack-expand-icon"
                  />
                </span>
              </>
            )}
          </button>
          {/* Always mounted, so screen readers hear the closed stack's latest
              call change ("read_file: Running", then "read_file: Done"); the
              button only names it. */}
          <span aria-live="polite" className="cpk-tool-call-group-stack-live">
            {open
              ? ""
              : `${latest.toolCall.function.name}: ${labels[STATUS_LABEL_KEYS[latestStatus]]}`}
          </span>
        </div>
        {open && (
          // Each call gets the collapsed stack's card, easing out of the stack.
          <div id={bodyId} className="cpk-tool-call-group-stack-items">
            <ToolCallGroupContext.Provider
              value={{ appearance: "stack", failedIds, active: isActive }}
            >
              {calls.map((call, index) => (
                <div
                  key={call.toolCall.id}
                  className={cn(layer, "cpk-tool-call-group-stack-item")}
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
      className={cn("cpk-tool-call-group cpk-tool-call-group-card", className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        className="cpk-tool-call-group-card-toggle"
      >
        <StatusIcon status={status} />
        {runningLabel || (
          <>
            <span className="cpk-tool-call-group-card-summary">
              {formatCountLabel(calls.length, {
                one: labels.toolCallUsedToolsOne,
                other: labels.toolCallUsedToolsOther,
              })}
            </span>
            <span className="cpk-tool-call-group-card-names">
              {ɵformatToolNames(calls)}
            </span>
          </>
        )}
        <span className="cpk-tool-call-group-card-meta">
          {status === "failed" ? (
            <FailedCount calls={calls} />
          ) : (
            <span className="cpk-tool-call-group-card-status">
              {status !== "running"
                ? labels[STATUS_LABEL_KEYS[status]]
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
