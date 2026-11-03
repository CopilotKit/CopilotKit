import React, { useContext, useState } from "react";
import { ToolCallStatus } from "@copilotkit/core";
import { useRenderTool } from "./use-render-tool";
import { cn } from "../lib/utils";
import {
  ToolCallGroupContext,
  ToolCallRow,
} from "../components/chat/CopilotChatToolCallGroup";

export type DefaultRenderProps = {
  /** The name of the tool being called. */
  name: string;
  /** The id of the tool call being rendered. */
  toolCallId: string;
  /** The parsed parameters passed to the tool call. */
  parameters: unknown;
  /** Current execution status of the tool call. */
  status: "inProgress" | "executing" | "complete";
  /** The tool call result string, available only when `status` is `"complete"`. */
  result: string | undefined;
};

/**
 * Shape that `useRenderToolCall` actually invokes a registered `*` renderer
 * with: `{ name, toolCallId, args, status: ToolCallStatus, result }`.
 *
 * `useDefaultRenderTool` accepts user `config.render` typed against the
 * documented {@link DefaultRenderProps}, then wraps it via {@link adaptRendererProps}
 * so the user's function receives the documented shape — not the raw
 * framework-internal one.
 */
type RawRendererProps = {
  name: string;
  toolCallId: string;
  args: unknown;
  status: ToolCallStatus;
  result: string | undefined;
};

/**
 * Module-level dedup set so an unknown status value only emits a console
 * warning the FIRST time we encounter it. Otherwise a stuck/unmapped status
 * would log on every re-render (potentially many per second).
 */
const warnedUnknownStatuses = new Set<string>();

/**
 * Map a {@link ToolCallStatus} enum value to the documented string-union
 * status the {@link DefaultRenderProps} contract exposes. Unknown / future
 * enum members log a warning (once per distinct value) and fall back to
 * `"inProgress"`.
 */
export function mapToolCallStatus(
  status: ToolCallStatus,
): DefaultRenderProps["status"] {
  switch (status) {
    case ToolCallStatus.Complete:
      return "complete";
    case ToolCallStatus.Executing:
      return "executing";
    case ToolCallStatus.InProgress:
      return "inProgress";
    default: {
      // Surface unknown / future enum values so callers know their custom
      // renderer is being invoked with an unmapped status. Fall back to
      // "inProgress" — the safest treat-as-pending default. Dedup by value
      // so a stuck unmapped status doesn't spam console on every render.
      const key = String(status);
      if (!warnedUnknownStatuses.has(key)) {
        warnedUnknownStatuses.add(key);
        console.warn(
          `[CopilotKit] Unknown ToolCallStatus "${key}" in default tool-call renderer; falling back to "inProgress".`,
        );
      }
      return "inProgress";
    }
  }
}

/**
 * Convert the framework-internal renderer props (`args`, enum status) into
 * the documented {@link DefaultRenderProps} shape (`parameters`, string-union
 * status) so a user `config.render` always sees the documented contract.
 */
export function adaptRendererProps(
  props: RawRendererProps,
): DefaultRenderProps {
  return {
    name: props.name,
    toolCallId: props.toolCallId,
    parameters: props.args,
    status: mapToolCallStatus(props.status),
    result: props.result,
  };
}

/**
 * Registers a wildcard (`"*"`) tool-call renderer via `useRenderTool`.
 *
 * - Call with no config to use CopilotKit's built-in default tool-call card.
 * - Pass `config.render` to replace the default UI with your own fallback renderer.
 *
 * This is useful when you want a generic renderer for tools that do not have a
 * dedicated `useRenderTool({ name: "..." })` registration.
 *
 * @param config - Optional custom wildcard render function.
 * @param deps - Optional dependencies to refresh registration.
 *
 * @example
 * ```tsx
 * useDefaultRenderTool();
 * ```
 *
 * @example
 * ```tsx
 * useDefaultRenderTool({
 *   render: ({ name, status }) => <div>{name}: {status}</div>,
 * });
 * ```
 *
 * @example
 * ```tsx
 * useDefaultRenderTool(
 *   {
 *     render: ({ name, result }) => (
 *       <ToolEventRow title={name} payload={result} compact={compactMode} />
 *     ),
 *   },
 *   [compactMode],
 * );
 * ```
 */
export function useDefaultRenderTool(
  config?: {
    render?: (props: DefaultRenderProps) => React.ReactElement | null;
    /**
     * Let the chat group calls your `render` draws, like it groups the
     * built-in card's (see `toolCallDisplay` on `CopilotChatMessageView`).
     * Off by default for a custom `render`, since it may draw nothing.
     */
    group?: boolean;
  },
  deps?: ReadonlyArray<unknown>,
): void {
  const userRender = config?.render;

  // When the caller supplies their own render, wrap it so it receives the
  // documented {@link DefaultRenderProps} (parameters, string-union status)
  // even though `useRenderToolCall` invokes the registered render with the
  // framework-internal `{ args, status: ToolCallStatus, ... }` shape.
  const registered: (props: RawRendererProps) => React.ReactElement | null =
    userRender
      ? (raw) => userRender(adaptRendererProps(raw))
      : (raw) => <DefaultToolCallRenderer {...adaptRendererProps(raw)} />;

  useRenderTool(
    {
      name: "*",
      // `useRenderTool` types the render with the raw framework signature
      // and still requires a `React.ReactElement` return; the wrapper above
      // adapts to the documented shape and may return `null`. We cast through
      // `unknown` to bridge both gaps without `as any`.
      render: registered as unknown as (props: unknown) => React.ReactElement,
      // The built-in card draws a row inside a group; a custom render opts in.
      group: userRender ? config?.group === true : true,
    },
    deps,
  );
}

/**
 * Guarded JSON.stringify used inside the expanded `<pre>` blocks. A circular
 * reference would otherwise crash the entire React tree on render.
 */
function safeStringifyForPre(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    console.warn(
      "[CopilotKit] Failed to JSON.stringify tool-call payload for default renderer; falling back to String():",
      err,
    );
    try {
      return String(value);
    } catch (innerErr) {
      console.warn(
        "[CopilotKit] safeStringifyForPre: value could not be stringified:",
        innerErr,
      );
      return "[unserializable]";
    }
  }
}

export function DefaultToolCallRenderer({
  name,
  toolCallId,
  parameters,
  status,
  result,
}: DefaultRenderProps): React.ReactElement {
  const group = useContext(ToolCallGroupContext);
  const [isExpanded, setIsExpanded] = useState(false);

  const isActive = status === "inProgress" || status === "executing";
  const isComplete = status === "complete";

  // Inside a group of calls, a row that fits the group instead of a card.
  if (group) {
    return (
      <ToolCallRow
        data-testid="copilot-tool-render"
        data-tool-name={name}
        data-tool-call-id={toolCallId}
        data-status={status}
        data-args={safeStringifyForAttr(parameters)}
        data-result={safeStringifyForAttr(result)}
        name={name}
        parameters={parameters}
        result={result}
        status={
          isComplete
            ? group.failedIds.has(toolCallId)
              ? "failed"
              : "done"
            : group.active
              ? "running"
              : "stopped"
        }
        appearance={group.appearance}
      />
    );
  }

  const statusLabel = isActive ? "Running" : isComplete ? "Done" : status;
  // Colors the status dot and badge: running, done, or anything else.
  const tone = isActive ? "running" : isComplete ? "done" : "other";

  return (
    <div
      data-testid="copilot-tool-render"
      data-tool-name={name}
      data-tool-call-id={toolCallId}
      data-status={status}
      data-args={safeStringifyForAttr(parameters)}
      data-result={safeStringifyForAttr(result)}
      className="cpk-default-tool-call"
    >
      <div className="cpk-default-tool-call-card">
        {/* Header row — always visible. A real <button> with aria-expanded
            and reset styles so it visually matches the previous <div> but
            is keyboard-accessible (Enter/Space toggle natively). */}
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          className="cpk-default-tool-call-header"
          style={{
            font: "inherit",
          }}
        >
          <div className="cpk-default-tool-call-title">
            <svg
              className={cn(
                "cpk-default-tool-call-chevron",
                isExpanded && "cpk-default-tool-call-chevron-open",
              )}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 4.5l7.5 7.5-7.5 7.5"
              />
            </svg>
            <span
              className={`cpk-default-tool-call-dot cpk-default-tool-call-dot-${tone}`}
            />
            <span
              data-testid="copilot-tool-render-name"
              className="cpk-default-tool-call-name"
            >
              {name}
            </span>
          </div>

          <span
            data-testid="copilot-tool-render-status"
            className={`cpk-default-tool-call-badge cpk-default-tool-call-badge-${tone}`}
          >
            {statusLabel}
          </span>
        </button>

        {/* Expandable details */}
        {isExpanded && (
          <div className="cpk-default-tool-call-details">
            <div>
              <div className="cpk-default-tool-call-label">Arguments</div>
              <pre className="cpk-default-tool-call-code">
                {safeStringifyForPre(parameters ?? {})}
              </pre>
            </div>

            {result !== undefined && (
              <div>
                <div className="cpk-default-tool-call-label">Result</div>
                <pre className="cpk-default-tool-call-code">
                  {typeof result === "string"
                    ? result
                    : safeStringifyForPre(result)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function safeStringifyForAttr(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (err) {
    console.warn(
      "[CopilotKit] Failed to JSON.stringify tool-call payload for data-* attribute; falling back to String():",
      err,
    );
    try {
      return String(value);
    } catch (innerErr) {
      console.warn(
        "[CopilotKit] safeStringifyForAttr: value could not be stringified:",
        innerErr,
      );
      return "";
    }
  }
}
