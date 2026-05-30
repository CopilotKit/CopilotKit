import { defineComponent, h, ref } from "vue";
import type { WatchSource } from "vue";
import type { Component, VNodeChild } from "vue";
import { ToolCallStatus } from "@copilotkit/core";
import { useRenderTool } from "./use-render-tool";

type DefaultRenderProps = {
  name: string;
  toolCallId: string;
  parameters: unknown;
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
};

/**
 * Shape that `CopilotChatToolCallsView` actually passes a registered `*`
 * renderer: `{ name, toolCallId, args, status: ToolCallStatus, result }`.
 * `useDefaultRenderTool` wraps user `config.render` so it sees the
 * documented `DefaultRenderProps` shape instead.
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
 * enum members log a warning and fall back to `"inProgress"`.
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
    default:
      console.warn(
        `[CopilotKit] Unknown ToolCallStatus "${String(
          status,
        )}" in default tool-call renderer; falling back to "inProgress".`,
      );
      return "inProgress";
  }
}

/**
 * Convert framework-internal RawRendererProps (`args`, enum status) to the
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
    } catch {
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
      type: String,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    const isExpanded = ref(false);

    return () => {
      const isActive =
        props.status === "inProgress" || props.status === "executing";
      const isComplete = props.status === "complete";
      const statusLabel = isActive
        ? "Running"
        : isComplete
          ? "Done"
          : props.status;

      return h(
        "div",
        {
          "data-testid": "copilot-tool-render",
          "data-tool-name": props.name,
          "data-tool-call-id": props.toolCallId,
          "data-status": props.status,
          "data-args": safeStringifyForAttr(props.parameters),
          "data-result": safeStringifyForAttr(props.result),
          style: { marginTop: "8px", paddingBottom: "8px" },
        },
        [
          h(
            "div",
            {
              style: {
                borderRadius: "12px",
                border: "1px solid #e4e4e7",
                backgroundColor: "#fafafa",
                padding: "14px 16px",
              },
            },
            [
              h(
                "button",
                {
                  type: "button",
                  "aria-expanded": String(isExpanded.value),
                  onClick: () => {
                    isExpanded.value = !isExpanded.value;
                  },
                  style: {
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    cursor: "pointer",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    background: "transparent",
                    textAlign: "left",
                  },
                },
                [
                  h(
                    "span",
                    {
                      "data-testid": "copilot-tool-render-name",
                      style: { fontWeight: "600" },
                    },
                    props.name,
                  ),
                  h(
                    "span",
                    { "data-testid": "copilot-tool-render-status" },
                    statusLabel,
                  ),
                ],
              ),
              isExpanded.value
                ? h("div", { style: { marginTop: "12px" } }, [
                    h("div", "Arguments"),
                    h("pre", safeStringifyForPre(props.parameters ?? {})),
                    props.result !== undefined
                      ? h("div", [
                          h("div", "Result"),
                          h(
                            "pre",
                            typeof props.result === "string"
                              ? props.result
                              : safeStringifyForPre(props.result),
                          ),
                        ])
                      : null,
                  ])
                : null,
            ],
          ),
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
    } catch {
      return "";
    }
  }
}

export function useDefaultRenderTool(
  config?: {
    render?:
      | ((props: DefaultRenderProps) => VNodeChild)
      | Component<DefaultRenderProps>;
  },
  deps?: WatchSource<unknown>[],
): void {
  const userRender = config?.render;

  // When the user supplies a function render, wrap it so they receive the
  // documented {@link DefaultRenderProps} shape regardless of whether the
  // call site passes `args + enum status` (CopilotChatToolCallsView's core
  // path) or `parameters + string status` (an already-adapted call site).
  // Component-typed renders are not wrapped: Vue's <component :is> binds
  // attrs by name, so we keep the component reference intact and let Vue
  // pass through whichever attrs the call site supplies.
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
    registeredRender = userRender;
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
    },
    deps,
  );
}
