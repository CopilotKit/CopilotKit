import { computed, defineComponent, h } from "vue";
import type { PropType } from "vue";
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
 * Inline styles, like React's A2UI loading states, so it needs no stylesheet.
 */
const DefaultA2UILoading = defineComponent({
  name: "DefaultA2UILoading",
  setup() {
    const barWidths = [0.8, 0.6, 0.4] as const;
    return () =>
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            minHeight: "120px",
            border: "1px solid oklch(96.7% 0.003 264.542)",
            borderRadius: "calc(var(--radius) + 4px)",
            backgroundColor:
              "color-mix(in oklab, oklch(98.5% 0.002 247.839) 50%, transparent)",
            padding: "1.25rem",
          },
          "data-testid": "a2ui-loading",
        },
        [
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "0.5rem" } },
            [
              h("div", {
                style: {
                  width: "0.75rem",
                  height: "0.75rem",
                  borderRadius: "9999px",
                  backgroundColor: "oklch(92.8% 0.006 264.531)",
                  animation: "cpk-a2ui-pulse 1.5s ease-in-out infinite",
                },
                "data-testid": "a2ui-loading-dot",
              }),
              h(
                "span",
                {
                  style: {
                    fontSize: "0.75rem",
                    lineHeight: "1rem",
                    fontWeight: 500,
                    color: "oklch(70.7% 0.022 261.325)",
                  },
                },
                "Generating UI...",
              ),
            ],
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              },
            },
            barWidths.map((width, i) =>
              h("div", {
                key: i,
                style: {
                  height: "0.75rem",
                  borderRadius: "0.25rem",
                  backgroundColor:
                    "color-mix(in oklab, oklch(92.8% 0.006 264.531) 70%, transparent)",
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
