import React, { useState } from "react";
import { useRenderTool } from "./use-render-tool";

type DefaultRenderProps = {
  name: string;
  args: any;
  status: string;
  result: string | undefined;
};

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
  useRenderTool(
    {
      name: "*",
      render: config?.render ?? DefaultToolCallRenderer,
    },
    deps,
  );
}

function DefaultToolCallRenderer({
  name,
  args,
  status,
  result,
}: DefaultRenderProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusString = String(status) as
    | "inProgress"
    | "executing"
    | "complete";
  const isActive =
    statusString === "inProgress" || statusString === "executing";
  const isComplete = statusString === "complete";

  const statusLabel = isActive ? "Running" : isComplete ? "Done" : status;
  const dotColor = isActive ? "#f59e0b" : isComplete ? "#10b981" : "#a1a1aa";
  const badgeBg = isActive ? "#fef3c7" : isComplete ? "#d1fae5" : "#f4f4f5";
  const badgeColor = isActive ? "#92400e" : isComplete ? "#065f46" : "#3f3f46";

  return (
    <div
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
        {/* Header row — always visible */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            cursor: "pointer",
            userSelect: "none",
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
        </div>

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
                {JSON.stringify(args ?? {}, null, 2)}
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
                    : JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
