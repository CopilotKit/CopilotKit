import { defineComponent, h, ref } from "vue";
import type { WatchSource } from "vue";
import type { Component, VNodeChild } from "vue";
import { ToolCallStatus } from "@copilotkit/core";
import { useRenderTool } from "./use-render-tool";
import {
  IconCheck,
  IconChevronRight,
  IconCircle,
  IconLoader2,
} from "../components/icons";

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

    return () => {
      const isActive =
        props.status === "inProgress" || props.status === "executing";
      const isComplete = props.status === "complete";
      const statusLabel = isActive
        ? "Running"
        : isComplete
          ? "Done"
          : props.status;
      const StatusIcon = isActive
        ? IconLoader2
        : isComplete
          ? IconCheck
          : IconCircle;
      const preClass =
        "cpk:m-0 cpk:mt-1.5 cpk:max-h-[200px] cpk:overflow-auto cpk:rounded-lg cpk:bg-muted cpk:p-2.5 cpk:font-mono cpk:text-xs cpk:leading-relaxed cpk:text-foreground cpk:whitespace-pre-wrap cpk:break-words";
      const labelClass =
        "cpk:text-[11px] cpk:font-medium cpk:uppercase cpk:tracking-wide cpk:text-muted-foreground";

      return h(
        "div",
        {
          "data-testid": "copilot-tool-render",
          "data-tool-name": props.name,
          "data-tool-call-id": props.toolCallId,
          "data-status": props.status,
          "data-args": safeStringifyForAttr(props.parameters),
          "data-result": safeStringifyForAttr(props.result),
          class: "cpk:my-2",
        },
        [
          h(
            "div",
            {
              class:
                "cpk:overflow-hidden cpk:rounded-xl cpk:border cpk:border-border cpk:bg-card cpk:text-card-foreground",
            },
            [
              // Header row — always visible. A real <button> with
              // aria-expanded so it is keyboard-accessible.
              h(
                "button",
                {
                  type: "button",
                  "aria-expanded": String(isExpanded.value),
                  onClick: () => {
                    isExpanded.value = !isExpanded.value;
                  },
                  class:
                    "cpk:flex cpk:w-full cpk:cursor-pointer cpk:select-none cpk:items-center cpk:gap-2.5 cpk:border-none cpk:bg-transparent cpk:m-0 cpk:px-3.5 cpk:py-2.5 cpk:text-left cpk:text-inherit cpk:transition-colors cpk:hover:bg-accent/60 cpk:focus-visible:outline-2 cpk:focus-visible:-outline-offset-2 cpk:focus-visible:outline-ring cpk:focus-visible:bg-accent/60",
                  style: { font: "inherit" },
                },
                [
                  h(StatusIcon, {
                    "aria-hidden": "true",
                    class: [
                      "cpk:size-3.5 cpk:shrink-0",
                      isComplete
                        ? "cpk:text-foreground"
                        : "cpk:text-muted-foreground",
                      isActive ? "cpk:animate-spin" : "",
                    ],
                  }),
                  h(
                    "span",
                    {
                      "data-testid": "copilot-tool-render-name",
                      class: [
                        "cpk:min-w-0 cpk:flex-1 cpk:truncate cpk:font-mono cpk:text-[13px] cpk:font-medium cpk:text-foreground",
                        isActive ? "cpk-shimmer" : "",
                      ],
                    },
                    props.name,
                  ),
                  h(
                    "span",
                    {
                      "data-testid": "copilot-tool-render-status",
                      class: [
                        "cpk:shrink-0 cpk:text-xs cpk:text-muted-foreground",
                        isActive ? "cpk-shimmer" : "",
                      ],
                    },
                    statusLabel,
                  ),
                  h(IconChevronRight, {
                    "aria-hidden": "true",
                    class: [
                      "cpk:size-3.5 cpk:shrink-0 cpk:text-muted-foreground cpk:transition-transform cpk:duration-200",
                      isExpanded.value ? "cpk:rotate-90" : "",
                    ],
                  }),
                ],
              ),
              isExpanded.value
                ? h(
                    "div",
                    {
                      class:
                        "cpk:grid cpk:gap-3 cpk:border-t cpk:border-border cpk:px-3.5 cpk:py-3",
                    },
                    [
                      h("div", [
                        h("div", { class: labelClass }, "Arguments"),
                        h(
                          "pre",
                          { class: preClass },
                          safeStringifyForPre(props.parameters ?? {}),
                        ),
                      ]),
                      props.result !== undefined
                        ? h("div", [
                            h("div", { class: labelClass }, "Result"),
                            h(
                              "pre",
                              { class: preClass },
                              typeof props.result === "string"
                                ? props.result
                                : safeStringifyForPre(props.result),
                            ),
                          ])
                        : null,
                    ],
                  )
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
    },
    deps,
  );
}
