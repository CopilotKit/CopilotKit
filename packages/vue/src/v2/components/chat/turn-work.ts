import { defineComponent, h, inject } from "vue";
import type { FunctionalComponent } from "vue";
import { CopilotChatCollapsible } from "./tool-call-group-parts";
import { ToolCallDisplayContextKey } from "./tool-call-display-context";

/**
 * Folds its content away with a reply's work in the `"turn"` display. Without
 * `open` (any other display) it renders the content as is.
 * @internal
 */
export const TurnWorkFold: FunctionalComponent<{ open?: boolean }> = (
  props,
  { slots },
) =>
  props.open === undefined
    ? slots.default?.()
    : h(CopilotChatCollapsible, { open: props.open }, slots);
TurnWorkFold.props = ["open"];

/**
 * In the `"turn"` tool-call display, text in a reply's working phase was
 * narration: it fades to muted once a call follows it, and folds away with the
 * rest of the work when the reply is done. The wrapper is there for every
 * message in that display, so text that turns into narration keeps its node
 * (and its place) rather than remounting.
 * @internal
 */
export const CopilotChatWorkText = defineComponent({
  name: "CopilotChatWorkText",
  props: { messageId: { type: String, required: true } },
  setup(props, { slots }) {
    const context = inject(ToolCallDisplayContextKey, null);
    return () => {
      if (context?.value.display !== "turn") return slots.default?.();
      const open = context.value.workTextOpen.get(props.messageId);
      return h(
        CopilotChatCollapsible,
        { open: open ?? true, class: "cpk-assistant-message-work-text" },
        () => [
          h(
            "div",
            {
              class: "cpk-assistant-message-work-text-content",
              "data-work-text": open === undefined ? "reply" : "narration",
            },
            slots.default?.(),
          ),
        ],
      );
    };
  },
});
