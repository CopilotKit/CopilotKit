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
  const dotColor = isActive ? "#f59e0b" : isComplete ? "#10b981" : "#a1a1aa";
  const badgeBg = isActive ? "#fef3c7" : isComplete ? "#d1fae5" : "#f4f4f5";
  const badgeColor = isActive ? "#92400e" : isComplete ? "#065f46" : "#3f3f46";

  return (
    <div
      data-testid="copilot-tool-render"
      data-tool-name={name}
      data-tool-call-id={toolCallId}
      data-status={status}
      data-args={safeStringifyForAttr(parameters)}
      data-result={safeStringifyForAttr(result)}
      style={{
        marginTop: "8px",
        paddingBottom: "8px",
      }}
    >
      <div
        style={{
          borderRadius: "12px",
          border: "1px solid #e4e4e7",
          backgroundColor: "#fafafa",
          padding: "14px 16px",
        }}
      >
        {/* Header row — always visible. A real <button> with aria-expanded
            and reset styles so it visually matches the previous <div> but
            is keyboard-accessible (Enter/Space toggle natively). */}
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            cursor: "pointer",
            userSelect: "none",
            width: "100%",
            border: "none",
            padding: 0,
            margin: 0,
            background: "transparent",
            textAlign: "left",
            font: "inherit",
            color: "inherit",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              minWidth: 0,
            }}
          >
            <svg
              style={{
                height: "14px",
                width: "14px",
                color: "#71717a",
                transition: "transform 0.15s",
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                flexShrink: 0,
              }}
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
              style={{
                display: "inline-block",
                height: "8px",
                width: "8px",
                borderRadius: "50%",
                backgroundColor: dotColor,
                flexShrink: 0,
              }}
            />
            <span
              data-testid="copilot-tool-render-name"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#18181b",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </span>
          </div>

          <span
            data-testid="copilot-tool-render-status"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "9999px",
              padding: "2px 8px",
              fontSize: "11px",
              fontWeight: 500,
              backgroundColor: badgeBg,
              color: badgeColor,
              flexShrink: 0,
            }}
          >
            {statusLabel}
          </span>
        </button>

        {/* Expandable details */}
        {isExpanded && (
          <div style={{ marginTop: "12px", display: "grid", gap: "12px" }}>
            <div>
              <div
                style={{
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#71717a",
                }}
              >
                Arguments
              </div>
              <pre
                style={{
                  marginTop: "6px",
                  maxHeight: "200px",
                  overflow: "auto",
                  borderRadius: "6px",
                  backgroundColor: "#f4f4f5",
                  padding: "10px",
                  fontSize: "11px",
                  lineHeight: 1.6,
                  color: "#27272a",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {safeStringifyForPre(parameters ?? {})}
              </pre>
            </div>

            {result !== undefined && (
              <div>
                <div
                  style={{
                    fontSize: "10px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#71717a",
                  }}
                >
                  Result
                </div>
                <pre
                  style={{
                    marginTop: "6px",
                    maxHeight: "200px",
                    overflow: "auto",
                    borderRadius: "6px",
                    backgroundColor: "#f4f4f5",
                    padding: "10px",
                    fontSize: "11px",
                    lineHeight: 1.6,
                    color: "#27272a",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
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
