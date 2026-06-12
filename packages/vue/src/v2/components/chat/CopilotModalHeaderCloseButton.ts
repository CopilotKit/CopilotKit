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
            "cpk:inline-flex cpk:size-8 cpk:items-center cpk:justify-center cpk:rounded-full cpk:text-muted-foreground cpk:transition cpk:cursor-pointer",
            "cpk:hover:bg-muted cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring",
            className,
          ],
          "aria-label": ariaLabel.value,
        },
        slots.default
          ? slots.default()
          : [h(IconX, { class: "cpk:h-4 cpk:w-4", "aria-hidden": true })],
      );
    };
  },
});
