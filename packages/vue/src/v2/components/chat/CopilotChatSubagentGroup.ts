import { defineComponent, h, inject } from "vue";
import type { ComputedRef, InjectionKey, PropType, Slots } from "vue";
import type { Message } from "@ag-ui/core";
import type { ɵSubagentGroup, ɵSubagentLayout } from "@copilotkit/core";
import CopilotChatMessageView from "./CopilotChatMessageView.vue";
import CopilotChatSubagent from "./CopilotChatSubagent.vue";

/**
 * @internal What the top message view provides so tool-call views deep in the
 * tree can render the groups anchored to their tool calls.
 */
export interface SubagentLayoutContext {
  layout: ɵSubagentLayout;
  /** Every message in the thread, so tool results pair with their calls. */
  messages: Message[];
  isRunning: boolean;
  /** The message view's slots, forwarded into every group body. */
  slots: Slots;
}

/** @internal */
export const SubagentLayoutKey: InjectionKey<
  ComputedRef<SubagentLayoutContext>
> = Symbol("CopilotChatSubagentLayout");

/**
 * @internal Renders one group: the `#subagent` slot when the app gave one,
 * else the default `CopilotChatSubagent`. The body is a message view over the
 * group's own messages, so the same message components and slots apply.
 */
export default defineComponent({
  name: "CopilotChatSubagentGroup",
  props: {
    group: { type: Object as PropType<ɵSubagentGroup>, required: true },
  },
  setup(props) {
    const context = inject(SubagentLayoutKey, null);
    const body = defineComponent({
      name: "CopilotChatSubagentBody",
      setup() {
        return () =>
          context &&
          h(
            CopilotChatMessageView,
            {
              messages: context.value.messages,
              isRunning: context.value.isRunning,
              subagentGroup: props.group,
            },
            context.value.slots,
          );
      },
    });

    return () => {
      if (!context) return null;
      const { subagentRunId, subagent, messages } = props.group;
      const custom = context.value.slots.subagent;
      if (custom) return custom({ subagentRunId, subagent, messages, body });
      return h(
        CopilotChatSubagent,
        { subagentRunId, subagent, messages },
        { default: () => h(body) },
      );
    };
  },
});
