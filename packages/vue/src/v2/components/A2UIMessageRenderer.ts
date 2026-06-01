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

/**
 * Default loading component shown while an A2UI surface is generating.
 * Mirrors React's `DefaultA2UILoading` in
 * `packages/react-core/src/v2/a2ui/A2UIMessageRenderer.tsx`:
 * an animated dot + "Generating UI..." label + three shimmer bars
 * (80% / 60% / 40% widths) with staggered `cpk-a2ui-pulse` opacity animation.
 */
const DefaultA2UILoading = defineComponent({
  name: "DefaultA2UILoading",
  setup() {
    const barWidths = [0.8, 0.6, 0.4] as const;
    return () =>
      h(
        "div",
        {
          class:
            "cpk:flex cpk:flex-col cpk:gap-3 cpk:rounded-xl cpk:border cpk:border-gray-100 cpk:bg-gray-50/50 cpk:p-5",
          style: { minHeight: "120px" },
          "data-testid": "a2ui-loading",
        },
        [
          h("div", { class: "cpk:flex cpk:items-center cpk:gap-2" }, [
            h("div", {
              class: "cpk:h-3 cpk:w-3 cpk:rounded-full cpk:bg-gray-200",
              style: {
                animation: "cpk-a2ui-pulse 1.5s ease-in-out infinite",
              },
              "data-testid": "a2ui-loading-dot",
            }),
            h(
              "span",
              {
                class: "cpk:text-xs cpk:font-medium cpk:text-gray-400",
              },
              "Generating UI...",
            ),
          ]),
          h(
            "div",
            { class: "cpk:flex cpk:flex-col cpk:gap-2" },
            barWidths.map((width, i) =>
              h("div", {
                key: i,
                class: "cpk:h-3 cpk:rounded cpk:bg-gray-200/70",
                style: {
                  width: `${width * 100}%`,
                  animation: `cpk-a2ui-pulse 1.5s ease-in-out ${i * 0.15}s infinite`,
                },
                "data-testid": "a2ui-loading-bar",
              }),
            ),
          ),
          h(
            "style",
            {},
            `@keyframes cpk-a2ui-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}`,
          ),
        ],
      );
  },
});

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
            return h(DefaultA2UILoading);
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
