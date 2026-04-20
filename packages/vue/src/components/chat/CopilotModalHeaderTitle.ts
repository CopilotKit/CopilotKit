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
          class: [
            "w-full text-base font-medium leading-none tracking-tight text-foreground",
            className,
          ],
        },
        slots.default ? slots.default() : [],
      );
    };
  },
});
