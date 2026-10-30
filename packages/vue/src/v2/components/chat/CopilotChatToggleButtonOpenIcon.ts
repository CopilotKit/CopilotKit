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
        class: ["cpk-chat-toggle-button-icon", className],
        strokeWidth: 1.75,
        fill: "currentColor",
      });
    };
  },
});
