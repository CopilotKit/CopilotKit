import { computed, defineComponent, h } from "vue";
import type { PropType } from "vue";
import { z } from "zod";
import type { VueActivityMessageRenderer } from "../types";
import type { A2UITheme } from "../types";
import A2UISurfaceActivityRenderer from "./A2UISurfaceActivityRenderer.vue";
import {
  A2UIBuildingState,
  A2UILifecycleFields,
  A2UIRecoveryFailure,
  A2UIRetryingState,
  resolveDebugExposure,
} from "./a2ui/A2UIRecoveryStates";
import type { A2UIRecoveryRendererOptions } from "./a2ui/A2UIRecoveryStates";

const A2UI_OPERATIONS_KEY = "a2ui_operations";

export type A2UIMessageRendererOptions = {
  theme: A2UITheme;
  catalog?: any;
  /** Optional custom loading component shown while the A2UI surface is building. */
  loadingComponent?: unknown;
  /**
   * Pre-paint recovery/loading UX options: timing before the "Retrying…"
   * sub-label appears, and how much retry/debug detail to surface.
   */
  recovery?: A2UIRecoveryRendererOptions;
};

/**
 * The `a2ui-surface` activity carries the WHOLE generative-UI lifecycle on one
 * stable messageId: pre-paint `status` ("building" | "retrying" | "failed")
 * with recovery detail, then `a2ui_operations` on paint. The states swap in
 * place, so the painted surface replaces the skeleton. `.passthrough()` keeps
 * the operations and any future fields.
 */
const A2UISurfaceContentSchema = z
  .object({
    a2ui_operations: z.array(z.any()).optional(),
    ...A2UILifecycleFields,
  })
  .passthrough();

export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): VueActivityMessageRenderer<any> {
  const showAfterMs = options.recovery?.showAfterMs ?? 2000;
  const showAfterAttempts = options.recovery?.showAfterAttempts ?? 2;
  const optionDebugExposure = options.recovery?.debugExposure ?? "collapsed";

  // Renders the pre-paint lifecycle state for a content snapshot.
  const renderLifecycle = (content: any) => {
    const debugExposure = resolveDebugExposure(content, optionDebugExposure);
    if (content?.status === "failed") {
      return h(A2UIRecoveryFailure, { content, debugExposure });
    }
    if (content?.status === "retrying") {
      return h(A2UIRetryingState, {
        content,
        showAfterMs,
        showAfterAttempts,
        debugExposure,
      });
    }
    // "building" / default: a host-supplied loader wins; else the skeleton.
    if (options.loadingComponent) {
      return h(options.loadingComponent as any);
    }
    return h(A2UIBuildingState, { content });
  };

  return {
    activityType: "a2ui-surface",
    content: A2UISurfaceContentSchema,
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
          // No painted surface yet → the pre-paint lifecycle state. It shares
          // this activity's messageId, so the painted surface below replaces
          // it in place once operations arrive.
          if (operations.value.length === 0) {
            return renderLifecycle(props.content);
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
