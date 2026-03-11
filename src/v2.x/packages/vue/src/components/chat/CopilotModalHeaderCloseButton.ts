import { computed, defineComponent, h, useAttrs } from "vue";
import { IconX } from "../icons";

export default defineComponent({
  name: "CopilotModalHeaderCloseButton",
  inheritAttrs: false,
  setup(_, { slots }) {
    const attrs = useAttrs();
    const ariaLabel = computed(() =>
      typeof attrs["aria-label"] === "string" ? attrs["aria-label"] : "Close",
    );

    return () => {
      const {
        class: className,
        type,
        ...rest
      } = attrs as Record<string, unknown>;

      return h(
        "button",
        {
          ...rest,
          type: typeof type === "string" ? type : "button",
          class: [
            "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition cursor-pointer",
            "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          ],
          "aria-label": ariaLabel.value,
        },
        slots.default ? slots.default() : [h(IconX, { class: "h-4 w-4", "aria-hidden": true })],
      );
    };
  },
});
