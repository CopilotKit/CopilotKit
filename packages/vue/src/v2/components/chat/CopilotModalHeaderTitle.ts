import { defineComponent, h } from "vue";

export default defineComponent({
  name: "CopilotModalHeaderTitle",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => {
      const { class: className, ...rest } = attrs as Record<string, unknown>;
      return h(
        "div",
        {
          ...rest,
          class: ["cpk-modal-header-title", className],
        },
        slots.default ? slots.default() : [],
      );
    };
  },
});
