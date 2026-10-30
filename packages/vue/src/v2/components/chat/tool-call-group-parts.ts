import { defineComponent, h, onMounted, ref, watch } from "vue";
import type { PropType } from "vue";
import { partialJSONParse } from "@copilotkit/shared";
import {
  IconCheck,
  IconChevronRight,
  IconCircle,
  IconLoader2,
  IconX,
} from "../icons";
import { useCopilotId } from "../ui/use-id";
import type { ToolCallEntry } from "./tool-call-layout";

/** A call that never got a result after the run ended (Stop, an error) is "stopped". */
export type ToolCallStatusName = "running" | "done" | "failed" | "stopped";

/**
 * A call without a result is running only while the group is active: once
 * the run has moved on or ended, its result is never coming.
 * @internal
 */
export const entryStatus = (
  { toolMessage }: ToolCallEntry,
  active: boolean,
): ToolCallStatusName =>
  toolMessage
    ? toolMessage.error
      ? "failed"
      : "done"
    : active
      ? "running"
      : "stopped";

/** @internal */
export const statusLabels: Record<ToolCallStatusName, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** The first non-empty string argument: usually a command, path or query. */
export function argumentPreview(parameters: unknown): string | undefined {
  if (!parameters || typeof parameters !== "object") return undefined;
  const value = Object.values(parameters).find(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return value?.replace(/\s+/g, " ");
}

/** @internal */
export const entryPreview = (entry: ToolCallEntry) =>
  argumentPreview(partialJSONParse(entry.toolCall.function.arguments));

/** "run_command ×2, read_file" */
export function toolNames(calls: ToolCallEntry[]): string {
  const counts = new Map<string, number>();
  for (const { toolCall } of calls) {
    const name = toolCall.function.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");
}

/** @internal */
export const pluralize = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Guarded JSON.stringify for the payload blocks. A circular reference would
 * otherwise crash the render.
 */
function stringifyPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    console.warn(
      "[CopilotKit] Failed to JSON.stringify tool-call payload; falling back to String():",
      err,
    );
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
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
      type: String as PropType<ToolCallStatusName>,
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
    return () => {
      const failed = props.calls.filter(
        (call) => call.toolMessage?.error,
      ).length;
      if (!failed) return null;
      return h(
        "span",
        { class: "cpk-tool-call-failed-count" },
        `${failed} failed`,
      );
    };
  },
});

function payload(label: string, value: unknown) {
  return h("div", [
    h("div", { class: "cpk-tool-call-payload-label" }, label),
    h("pre", { class: "cpk-tool-call-payload-code" }, stringifyPayload(value)),
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
      type: String as PropType<ToolCallStatusName>,
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
    return () => {
      const preview = argumentPreview(props.parameters);
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
                statusLabels[props.status],
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
                payload("Arguments", props.parameters ?? {}),
                props.result !== undefined
                  ? payload("Result", props.result)
                  : null,
              ],
            ),
          ]),
        ],
      );
    };
  },
});
