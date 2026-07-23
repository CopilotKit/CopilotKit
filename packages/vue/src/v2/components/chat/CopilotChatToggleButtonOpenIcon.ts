import { defineComponent, h } from "vue";
import { IconMessageCircle } from "../icons";

export default defineComponent({
  name: "CopilotChatToggleButtonOpenIcon",
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => {
      const { class: className, ...rest } = attrs as Record<string, unknown>;
      return h(IconMessageCircle, {
        ...rest,
        class: ["cpk:h-6 cpk:w-6", className],
        strokeWidth: 1.75,
        fill: "currentColor",
      });
    };
  },
});
