import React, { useState } from "react";
import { ToolCallStatus } from "@copilotkit/core";
import { useRenderTool } from "./use-render-tool";

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
    render?: (props: DefaultRenderProps) => React.ReactElement;
  },
  deps?: ReadonlyArray<unknown>,
): void {
  const userRender = config?.render;

  // When the caller supplies their own render, wrap it so it receives the
  // documented {@link DefaultRenderProps} (parameters, string-union status)
  // even though `useRenderToolCall` invokes the registered render with the
  // framework-internal `{ args, status: ToolCallStatus, ... }` shape.
  const registered: (props: RawRendererProps) => React.ReactElement = userRender
    ? (raw) => userRender(adaptRendererProps(raw))
    : (raw) => <DefaultToolCallRenderer {...adaptRendererProps(raw)} />;

  useRenderTool(
    {
      name: "*",
      // `useRenderTool` types the render with the raw framework signature;
      // the wrapper above adapts to the documented shape. We cast through
      // `unknown` to bridge the public type without `as any`.
      render: registered as unknown as (props: unknown) => React.ReactElement,
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
  const [isExpanded, setIsExpanded] = useState(false);

  const isActive = status === "inProgress" || status === "executing";
  const isComplete = status === "complete";

  const statusLabel = isActive ? "Running" : isComplete ? "Done" : status;
  const dotClassName = isActive
    ? "cpk:bg-amber-500"
    : isComplete
      ? "cpk:bg-emerald-500"
      : "cpk:bg-zinc-400";
  const badgeClassName = isActive
    ? "cpk:bg-amber-100 cpk:text-amber-800 cpk:dark:bg-amber-500/15 cpk:dark:text-amber-400"
    : isComplete
      ? "cpk:bg-emerald-100 cpk:text-emerald-800 cpk:dark:bg-emerald-500/15 cpk:dark:text-emerald-400"
      : "cpk:bg-zinc-100 cpk:text-zinc-800 cpk:dark:bg-zinc-700/40 cpk:dark:text-zinc-300";

  return (
    <div
      data-testid="copilot-tool-render"
      data-tool-name={name}
      data-tool-call-id={toolCallId}
      data-status={status}
      data-args={safeStringifyForAttr(parameters)}
      data-result={safeStringifyForAttr(result)}
      className="cpk:mt-2 cpk:pb-2"
    >
      <div className="cpk:rounded-xl cpk:border cpk:border-zinc-200/60 cpk:bg-white/70 cpk:p-4 cpk:shadow-sm cpk:backdrop-blur cpk:dark:border-zinc-800/60 cpk:dark:bg-zinc-900/50">
        {/* Header row — always visible. A real <button> with aria-expanded
            and reset styles so it visually matches the previous <div> but
            is keyboard-accessible (Enter/Space toggle natively). */}
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          className="cpk:flex cpk:w-full cpk:cursor-pointer cpk:select-none cpk:items-center cpk:justify-between cpk:gap-2.5 cpk:border-none cpk:bg-transparent cpk:p-0 cpk:m-0 cpk:text-left cpk:text-inherit"
          style={{
            font: "inherit",
          }}
        >
          <div className="cpk:flex cpk:min-w-0 cpk:items-center cpk:gap-2">
            <svg
              className={`cpk:h-3.5 cpk:w-3.5 cpk:flex-shrink-0 cpk:text-zinc-500 cpk:transition-transform cpk:dark:text-zinc-400 ${
                isExpanded ? "cpk:rotate-90" : ""
              }`}
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
              className={`cpk:inline-block cpk:h-2 cpk:w-2 cpk:flex-shrink-0 cpk:rounded-full ${dotClassName}`}
            />
            <span
              data-testid="copilot-tool-render-name"
              className="cpk:truncate cpk:text-[13px] cpk:font-semibold cpk:text-zinc-900 cpk:dark:text-zinc-100"
            >
              {name}
            </span>
          </div>

          <span
            data-testid="copilot-tool-render-status"
            className={`cpk:inline-flex cpk:flex-shrink-0 cpk:items-center cpk:rounded-full cpk:px-2 cpk:py-0.5 cpk:text-[11px] cpk:font-medium ${badgeClassName}`}
          >
            {statusLabel}
          </span>
        </button>

        {/* Expandable details */}
        {isExpanded && (
          <div className="cpk:mt-3 cpk:grid cpk:gap-3">
            <div>
              <div className="cpk:text-[10px] cpk:uppercase cpk:text-zinc-500 cpk:dark:text-zinc-400">
                Arguments
              </div>
              <pre className="cpk:mt-1.5 cpk:max-h-[200px] cpk:overflow-auto cpk:rounded-md cpk:bg-zinc-100 cpk:p-2.5 cpk:text-[11px] cpk:leading-relaxed cpk:text-zinc-800 cpk:whitespace-pre-wrap cpk:break-words cpk:dark:bg-zinc-800/60 cpk:dark:text-zinc-200">
                {safeStringifyForPre(parameters ?? {})}
              </pre>
            </div>

            {result !== undefined && (
              <div>
                <div className="cpk:text-[10px] cpk:uppercase cpk:text-zinc-500 cpk:dark:text-zinc-400">
                  Result
                </div>
                <pre className="cpk:mt-1.5 cpk:max-h-[200px] cpk:overflow-auto cpk:rounded-md cpk:bg-zinc-100 cpk:p-2.5 cpk:text-[11px] cpk:leading-relaxed cpk:text-zinc-800 cpk:whitespace-pre-wrap cpk:break-words cpk:dark:bg-zinc-800/60 cpk:dark:text-zinc-200">
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
