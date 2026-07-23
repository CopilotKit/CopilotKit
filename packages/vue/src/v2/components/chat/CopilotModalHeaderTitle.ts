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
            "cpk:w-full cpk:text-base cpk:font-medium cpk:leading-none cpk:tracking-tight cpk:text-foreground",
            className,
          ],
        },
        slots.default ? slots.default() : [],
      );
    };
  },
});
