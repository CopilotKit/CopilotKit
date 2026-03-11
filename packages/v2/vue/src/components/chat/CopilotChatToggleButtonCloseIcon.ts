import { defineComponent, h } from "vue";
import { IconX } from "../icons";

export default defineComponent({
  name: "CopilotChatToggleButtonCloseIcon",
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => {
      const { class: className, ...rest } = attrs as Record<string, unknown>;
      return h(IconX, {
        ...rest,
        class: ["h-6 w-6", className],
        strokeWidth: 1.75,
      });
    };
  },
});
