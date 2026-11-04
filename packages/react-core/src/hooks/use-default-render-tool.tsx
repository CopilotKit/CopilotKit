import React, { useContext, useState } from "react";
import {
  CopilotChatDefaultLabels,
  ɵadaptDefaultToolCallRenderProps,
  ɵgetToolCallBadge,
  ɵnormalizeToolCallStatus,
  ɵstringifyToolCallAttr,
  ɵstringifyToolCallPayload,
  ɵtoDefaultToolCallStatus,
} from "@copilotkit/core";
import type {
  ToolCallStatus,
  ɵDefaultToolCallRenderProps,
} from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import { useRenderTool } from "./use-render-tool";
import { cn } from "../lib/utils";
import {
  ToolCallGroupContext,
  ToolCallRow,
} from "../components/chat/CopilotChatToolCallGroup";

/** What a custom `useDefaultRenderTool` render receives. */
export type DefaultRenderProps = ɵDefaultToolCallRenderProps;

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
 * Map a {@link ToolCallStatus} enum value to the documented string-union
 * status the {@link DefaultRenderProps} contract exposes. Unknown / future
 * enum members log a warning (once per distinct value) and fall back to
 * `"inProgress"`.
 */
export const mapToolCallStatus: (
  status: ToolCallStatus,
) => DefaultRenderProps["status"] = ɵtoDefaultToolCallStatus;

/**
 * Convert the framework-internal renderer props (`args`, enum status) into
 * the documented {@link DefaultRenderProps} shape (`parameters`, string-union
 * status) so a user `config.render` always sees the documented contract.
 */
export const adaptRendererProps: (
  props: RawRendererProps,
) => DefaultRenderProps = ɵadaptDefaultToolCallRenderProps;

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

export function DefaultToolCallRenderer({
  name,
  toolCallId,
  parameters,
  status,
  result,
}: DefaultRenderProps): React.ReactElement {
  const group = useContext(ToolCallGroupContext);
  const labels =
    useCopilotChatConfiguration()?.labels ?? CopilotChatDefaultLabels;
  const [isExpanded, setIsExpanded] = useState(false);

  // A status a newer runtime could send reads "unknown".
  const cardStatus = ɵnormalizeToolCallStatus(status);

  // Inside a group of calls, a row that fits the group instead of a card.
  if (group) {
    return (
      <ToolCallRow
        data-testid="copilot-tool-render"
        data-tool-name={name}
        data-tool-call-id={toolCallId}
        data-status={cardStatus}
        data-args={ɵstringifyToolCallAttr(parameters)}
        data-result={ɵstringifyToolCallAttr(result)}
        name={name}
        parameters={parameters}
        result={result}
        status={group.statusById.get(toolCallId) ?? "done"}
        appearance={group.appearance}
      />
    );
  }

  // Colors the status dot and badge: running, done, or anything else.
  const { tone, labelKey } = ɵgetToolCallBadge(cardStatus);
  const statusLabel = labels[labelKey];

  return (
    <div
      data-testid="copilot-tool-render"
      data-tool-name={name}
      data-tool-call-id={toolCallId}
      data-status={cardStatus}
      data-args={ɵstringifyToolCallAttr(parameters)}
      data-result={ɵstringifyToolCallAttr(result)}
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
              <div className="cpk-default-tool-call-label">
                {labels.toolCallArgumentsLabel}
              </div>
              <pre className="cpk-default-tool-call-code">
                {ɵstringifyToolCallPayload(parameters ?? {})}
              </pre>
            </div>

            {result !== undefined && (
              <div>
                <div className="cpk-default-tool-call-label">
                  {labels.toolCallResultLabel}
                </div>
                <pre className="cpk-default-tool-call-code">
                  {ɵstringifyToolCallPayload(result)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
