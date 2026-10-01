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
            "cpk:w-full cpk:truncate cpk:text-sm cpk:font-semibold cpk:leading-none cpk:text-foreground",
            className,
          ],
        },
        slots.default ? slots.default() : [],
      );
    };
  },
});
