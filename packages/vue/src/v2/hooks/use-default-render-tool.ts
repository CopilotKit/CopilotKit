import { defineComponent, h, inject, ref } from "vue";
import type { WatchSource } from "vue";
import type { Component, VNodeChild } from "vue";
import { ToolCallStatus } from "@copilotkit/core";
import { useRenderTool } from "./use-render-tool";
import { ToolCallGroupContextKey } from "../components/chat/tool-call-display-context";
import { ToolCallRow } from "../components/chat/tool-call-group-parts";

type DefaultRenderProps = {
  name: string;
  toolCallId: string;
  parameters: unknown;
  status: "inProgress" | "executing" | "complete";
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
function mapToolCallStatus(
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
 * Convert framework-internal raw renderer props (`args`, enum status) to the
 * documented DefaultRenderProps shape. Idempotent on already-documented input
 * — if the caller passes `parameters` and a string-union `status`, those win.
 */
type AdaptInput = {
  name?: unknown;
  toolCallId?: unknown;
  args?: unknown;
  parameters?: unknown;
  status?: unknown;
  result?: unknown;
};

function adaptRendererProps(raw: AdaptInput): DefaultRenderProps {
  const parameters = raw.parameters !== undefined ? raw.parameters : raw.args;
  const rawStatus = raw.status;
  const status: DefaultRenderProps["status"] =
    rawStatus === "inProgress" ||
    rawStatus === "executing" ||
    rawStatus === "complete"
      ? rawStatus
      : mapToolCallStatus(rawStatus as ToolCallStatus);
  return {
    name: raw.name as string,
    toolCallId: raw.toolCallId as string,
    parameters,
    status,
    result: raw.result as string | undefined,
  };
}

/**
 * Guarded JSON.stringify for the expanded `<pre>` blocks. A circular reference
 * would otherwise crash the Vue render.
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

const DefaultToolCallRenderer = defineComponent({
  props: {
    name: {
      type: String,
      required: true,
    },
    toolCallId: {
      type: String,
      required: true,
    },
    parameters: {
      type: null,
      required: false,
      default: undefined,
    },
    status: {
      type: String as () => "inProgress" | "executing" | "complete",
      required: true,
    },
    result: {
      // Typeless on purpose: the renderer body handles both string results
      // and structured (object) results via `safeStringifyForPre`. Declaring
      // `type: String` would trip Vue's dev-mode prop-type warning on every
      // non-string result and make the defensive branch unreachable.
      type: null,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    const isExpanded = ref(false);
    const groupContext = inject(ToolCallGroupContextKey, null);

    return () => {
      const group = groupContext?.value;
      // Inside a group of calls, a row that fits the group instead of a card.
      if (group) {
        return h(ToolCallRow, {
          "data-testid": "copilot-tool-render",
          "data-tool-name": props.name,
          "data-tool-call-id": props.toolCallId,
          "data-status": props.status,
          "data-args": safeStringifyForAttr(props.parameters),
          "data-result": safeStringifyForAttr(props.result),
          name: props.name,
          parameters: props.parameters,
          result: props.result,
          status:
            props.status === "complete"
              ? group.failedIds.has(props.toolCallId)
                ? "failed"
                : "done"
              : group.active
                ? "running"
                : "stopped",
          appearance: group.appearance,
        });
      }

      const isActive =
        props.status === "inProgress" || props.status === "executing";
      const isComplete = props.status === "complete";
      const statusLabel = isActive
        ? "Running"
        : isComplete
          ? "Done"
          : props.status;
      const tone = isActive ? "running" : isComplete ? "done" : "other";

      // Markup and classes match React's DefaultToolCallRenderer; styles live
      // in @copilotkit/core (default-tool-call.css).
      return h(
        "div",
        {
          "data-testid": "copilot-tool-render",
          "data-tool-name": props.name,
          "data-tool-call-id": props.toolCallId,
          "data-status": props.status,
          "data-args": safeStringifyForAttr(props.parameters),
          "data-result": safeStringifyForAttr(props.result),
          class: "cpk-default-tool-call",
        },
        [
          h("div", { class: "cpk-default-tool-call-card" }, [
            h(
              "button",
              {
                type: "button",
                "aria-expanded": String(isExpanded.value),
                onClick: () => {
                  isExpanded.value = !isExpanded.value;
                },
                class: "cpk-default-tool-call-header",
                style: { font: "inherit" },
              },
              [
                h("div", { class: "cpk-default-tool-call-title" }, [
                  h(
                    "svg",
                    {
                      class: [
                        "cpk-default-tool-call-chevron",
                        isExpanded.value &&
                          "cpk-default-tool-call-chevron-open",
                      ],
                      fill: "none",
                      viewBox: "0 0 24 24",
                      "stroke-width": 2,
                      stroke: "currentColor",
                    },
                    [
                      h("path", {
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round",
                        d: "M8.25 4.5l7.5 7.5-7.5 7.5",
                      }),
                    ],
                  ),
                  h("span", {
                    class: `cpk-default-tool-call-dot cpk-default-tool-call-dot-${tone}`,
                  }),
                  h(
                    "span",
                    {
                      "data-testid": "copilot-tool-render-name",
                      class: "cpk-default-tool-call-name",
                    },
                    props.name,
                  ),
                ]),
                h(
                  "span",
                  {
                    "data-testid": "copilot-tool-render-status",
                    class: `cpk-default-tool-call-badge cpk-default-tool-call-badge-${tone}`,
                  },
                  statusLabel,
                ),
              ],
            ),
            isExpanded.value
              ? h("div", { class: "cpk-default-tool-call-details" }, [
                  h("div", [
                    h(
                      "div",
                      { class: "cpk-default-tool-call-label" },
                      "Arguments",
                    ),
                    h(
                      "pre",
                      { class: "cpk-default-tool-call-code" },
                      safeStringifyForPre(props.parameters ?? {}),
                    ),
                  ]),
                  props.result !== undefined
                    ? h("div", [
                        h(
                          "div",
                          { class: "cpk-default-tool-call-label" },
                          "Result",
                        ),
                        h(
                          "pre",
                          { class: "cpk-default-tool-call-code" },
                          typeof props.result === "string"
                            ? props.result
                            : safeStringifyForPre(props.result),
                        ),
                      ])
                    : null,
                ])
              : null,
          ]),
        ],
      );
    };
  },
});

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

export function useDefaultRenderTool(
  config?: {
    render?:
      | ((props: DefaultRenderProps) => VNodeChild)
      | Component<DefaultRenderProps>;
    /**
     * Let the chat group calls your `render` draws, like it groups the
     * built-in card's (see `toolCallDisplay` on `CopilotChatMessageView`).
     * Off by default for a custom `render`, since it may draw nothing.
     */
    group?: boolean;
  },
  deps?: WatchSource<unknown>[],
): void {
  const userRender = config?.render;

  // When the user supplies a function render, wrap it so they receive the
  // documented {@link DefaultRenderProps} shape regardless of whether the
  // call site passes `args + enum status` (CopilotChatToolCallsView's core
  // path) or `parameters + string status` (an already-adapted call site).
  // Component-typed renders are also wrapped — Vue would bind whatever attrs
  // the call site passes, which means a component-typed render would receive
  // the raw `{ args, status: <enum> }` shape instead of the documented
  // `{ parameters, status: <string-union> }` shape. Wrap so the user
  // component sees `DefaultRenderProps`.
  let registeredRender:
    | ((props: DefaultRenderProps) => VNodeChild)
    | Component<DefaultRenderProps>;

  if (typeof userRender === "function") {
    const fn = userRender as (props: DefaultRenderProps) => VNodeChild;
    registeredRender = ((rawProps: AdaptInput) => {
      const adapted = adaptRendererProps(rawProps);
      return fn(adapted);
    }) as (props: DefaultRenderProps) => VNodeChild;
  } else if (userRender) {
    const userComponent = userRender;
    registeredRender = ((rawProps: AdaptInput) => {
      const adapted = adaptRendererProps(rawProps);
      return h(userComponent as Component, {
        name: adapted.name,
        toolCallId: adapted.toolCallId,
        parameters: adapted.parameters,
        status: adapted.status,
        result: adapted.result,
      });
    }) as (props: DefaultRenderProps) => VNodeChild;
  } else {
    registeredRender = ((rawProps: AdaptInput) => {
      const adapted = adaptRendererProps(rawProps);
      return h(DefaultToolCallRenderer, {
        name: adapted.name,
        toolCallId: adapted.toolCallId,
        parameters: adapted.parameters,
        status: adapted.status,
        result: adapted.result,
      });
    }) as (props: DefaultRenderProps) => VNodeChild;
  }

  useRenderTool(
    {
      name: "*",
      render: registeredRender,
      // The built-in card draws a row inside a group; a custom render opts in.
      group: userRender ? config?.group === true : true,
    },
    deps,
  );
}
