import { defineComponent, h, onMounted, ref, watch } from "vue";
import type { PropType } from "vue";
import {
  ɵcountFailedToolCalls,
  ɵformatLabel,
  ɵgetArgumentPreview,
  ɵstringifyToolCallPayload,
} from "@copilotkit/core";
import type {
  CopilotChatLabels,
  ToolCallEntry,
  ɵToolCallRowStatus,
} from "@copilotkit/core";
import {
  IconCheck,
  IconChevronRight,
  IconCircle,
  IconLoader2,
  IconX,
} from "../icons";
import { useCopilotId } from "../ui/use-id";
import { useChatLabels } from "./use-chat-labels";

/**
 * The label for a tool call's status ("Running", "Done", ...).
 * @internal
 */
export function toolCallStatusLabel(
  labels: Readonly<CopilotChatLabels>,
  status: ɵToolCallRowStatus,
) {
  switch (status) {
    case "running":
      return labels.toolCallStatusRunningLabel;
    case "done":
      return labels.toolCallStatusDoneLabel;
    case "failed":
      return labels.toolCallStatusFailedLabel;
    case "stopped":
      return labels.toolCallStatusStoppedLabel;
  }
}

/**
 * A count with the label that fits it: the `...One` template for 1, the
 * `...Other` template for any other count.
 * @internal
 */
export function formatCountLabel(
  count: number,
  templates: { one: string; other: string },
) {
  return ɵformatLabel(count === 1 ? templates.one : templates.other, {
    count,
  });
}

/**
 * Height transition between closed and its content's height. Closed content
 * stays mounted (so its state survives) but is inert.
 * @internal
 */
export const CopilotChatCollapsible = defineComponent({
  name: "CopilotChatCollapsible",
  props: {
    open: { type: Boolean, required: true },
    id: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const root = ref<HTMLElement | null>(null);
    // Set as an attribute, so closed content leaves the tab order everywhere.
    const syncInert = () => root.value?.toggleAttribute("inert", !props.open);
    onMounted(syncInert);
    watch(() => props.open, syncInert, { flush: "post" });
    return () =>
      h(
        "div",
        {
          ref: root,
          id: props.id,
          class: "cpk-collapsible",
          style: { gridTemplateRows: props.open ? "1fr" : "0fr" },
        },
        [h("div", { class: "cpk-collapsible-content" }, slots.default?.())],
      );
  },
});

/** @internal */
export const ToolCallStatusIcon = defineComponent({
  name: "ToolCallStatusIcon",
  props: {
    status: {
      type: String as PropType<ɵToolCallRowStatus>,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h(
        {
          running: IconLoader2,
          done: IconCheck,
          failed: IconX,
          stopped: IconCircle,
        }[props.status],
        {
          "aria-hidden": "true",
          class: [
            "cpk-tool-call-status-icon",
            props.status === "running" && "cpk-tool-call-status-icon-running",
            props.status === "failed" && "cpk-tool-call-status-icon-failed",
          ],
        },
      );
  },
});

/** @internal */
export const ToolCallChevron = defineComponent({
  name: "ToolCallChevron",
  props: { open: { type: Boolean, required: true } },
  setup(props) {
    return () =>
      h(IconChevronRight, {
        "aria-hidden": "true",
        class: [
          "cpk-tool-call-chevron",
          props.open && "cpk-tool-call-chevron-open",
        ],
      });
  },
});

/** "2 failed", or nothing. @internal */
export const ToolCallFailedCount = defineComponent({
  name: "ToolCallFailedCount",
  props: {
    calls: { type: Array as PropType<ToolCallEntry[]>, required: true },
  },
  setup(props) {
    const labels = useChatLabels();
    return () => {
      const failed = ɵcountFailedToolCalls(props.calls);
      if (!failed) return null;
      return h(
        "span",
        { class: "cpk-tool-call-failed-count" },
        ɵformatLabel(labels.value.toolCallFailedCountLabel, { count: failed }),
      );
    };
  },
});

function payload(label: string, value: unknown) {
  return h("div", [
    h("div", { class: "cpk-tool-call-payload-label" }, label),
    h(
      "pre",
      { class: "cpk-tool-call-payload-code" },
      ɵstringifyToolCallPayload(value),
    ),
  ]);
}

/**
 * The built-in tool card drawn as a row inside a group: status, name and main
 * argument, opening to the payloads.
 * @internal
 */
export const ToolCallRow = defineComponent({
  name: "ToolCallRow",
  props: {
    name: { type: String, required: true },
    parameters: { type: null, default: undefined },
    result: { type: null, default: undefined },
    status: {
      type: String as PropType<ɵToolCallRowStatus>,
      required: true,
    },
    appearance: {
      type: String as PropType<"card" | "line" | "stack">,
      required: true,
    },
  },
  setup(props) {
    const open = ref(false);
    const detailsId = useCopilotId("cpk-tool-call-row");
    const labels = useChatLabels();
    return () => {
      const preview = ɵgetArgumentPreview(props.parameters);
      // Rows draw their own divider: a wrapper with `display: contents`
      // around each call would escape a parent's divide-y.
      return h(
        "div",
        {
          "data-copilotkit": "",
          class: ["cpk-tool-call-row", `cpk-tool-call-row-${props.appearance}`],
        },
        [
          h(
            "button",
            {
              type: "button",
              "aria-expanded": open.value ? "true" : "false",
              "aria-controls": detailsId,
              onClick: () => {
                open.value = !open.value;
              },
              class: "cpk-tool-call-row-button",
            },
            [
              h(ToolCallStatusIcon, { status: props.status }),
              h(
                "span",
                {
                  "data-testid": "copilot-tool-render-name",
                  class: [
                    "cpk-tool-call-row-name",
                    props.status === "running" && "cpk-shimmer",
                  ],
                },
                props.name,
              ),
              preview
                ? h("span", { class: "cpk-tool-call-row-preview" }, preview)
                : null,
              h(
                "span",
                {
                  "data-testid": "copilot-tool-render-status",
                  class: "cpk-tool-call-row-status",
                },
                toolCallStatusLabel(labels.value, props.status),
              ),
              h(IconChevronRight, {
                "aria-hidden": "true",
                class: [
                  "cpk-tool-call-chevron",
                  open.value && "cpk-tool-call-chevron-open",
                  "cpk-tool-call-row-chevron",
                ],
              }),
            ],
          ),
          h(CopilotChatCollapsible, { open: open.value, id: detailsId }, () => [
            h(
              "div",
              { class: "cpk-tool-call-payloads cpk-tool-call-row-payloads" },
              [
                payload(
                  labels.value.toolCallArgumentsLabel,
                  props.parameters ?? {},
                ),
                props.result !== undefined
                  ? payload(labels.value.toolCallResultLabel, props.result)
                  : null,
              ],
            ),
          ]),
        ],
      );
    };
  },
});
