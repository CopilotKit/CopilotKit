import { computed, defineComponent, h, type PropType } from "vue";
import { z } from "zod";
import type { VueActivityMessageRenderer } from "../types";
import type { A2UITheme } from "../types";
import A2UISurfaceActivityRenderer from "./A2UISurfaceActivityRenderer.vue";

const A2UI_OPERATIONS_KEY = "a2ui_operations";

export type A2UIMessageRendererOptions = {
  theme: A2UITheme;
  catalog?: any;
  loadingComponent?: unknown;
};

export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): VueActivityMessageRenderer<any> {
  return {
    activityType: "a2ui-surface",
    content: z.any(),
    render: defineComponent({
      name: "A2UIMessageRendererHost",
      props: {
        activityType: { type: String, required: true },
        content: { type: Object as PropType<any>, required: true },
        message: { type: Object as PropType<any>, required: true },
        agent: {
          type: Object as PropType<any>,
          required: false,
          default: undefined,
        },
      },
      setup(props) {
        const operations = computed(() =>
          Array.isArray(props.content?.[A2UI_OPERATIONS_KEY])
            ? props.content[A2UI_OPERATIONS_KEY]
            : [],
        );

        return () => {
          if (operations.value.length === 0) {
            if (options.loadingComponent) {
              return h(options.loadingComponent as any);
            }
            return h(
              "div",
              {
                class:
                  "cpk:flex cpk:flex-col cpk:gap-3 cpk:rounded-xl cpk:border cpk:border-gray-100 cpk:bg-gray-50/50 cpk:p-5",
                style: { minHeight: "120px" },
                "data-testid": "a2ui-loading",
              },
              "Generating UI...",
            );
          }

          return h(A2UISurfaceActivityRenderer, {
            activityType: "a2ui-surface",
            content: { operations: operations.value },
            message: props.message,
            agent: props.agent,
            theme: options.theme,
            catalog: options.catalog,
          });
        };
      },
    }),
  };
}
