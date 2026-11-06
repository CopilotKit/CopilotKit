import { defineComponent, h, onBeforeUnmount, shallowRef, watch } from "vue";
import type { Component, PropType } from "vue";
import {
  ɵA2UIActivityController,
  ɵA2UI_SURFACE_ACTIVITY_TYPE,
  ɵA2UI_SURFACE_CONTENT_SCHEMA,
} from "@copilotkit/core";
import type {
  ɵA2UIActionAgent,
  ɵA2UIActionInterceptor,
  ɵA2UISurfaceContent,
} from "@copilotkit/core";
import type { ActivityMessage } from "@ag-ui/core";
import type { VueActivityMessageRenderer } from "../types";
import type { A2UITheme } from "../types";
import A2UISurfaceActivityRenderer from "./A2UISurfaceActivityRenderer.vue";
import { renderA2UILifecycleState } from "./a2ui/A2UIRecoveryStates";
import type { A2UIRecoveryRendererOptions } from "./a2ui/A2UIRecoveryStates";

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
  /**
   * Intercept actions before they reach the agent: return `null` to handle an
   * action client-side, return an action to forward that one instead, or
   * return nothing to forward it unchanged.
   */
  onAction?: ɵA2UIActionInterceptor;
};

function isComponent(value: unknown): value is Component {
  return (
    typeof value === "function" || (typeof value === "object" && value !== null)
  );
}

/**
 * The `a2ui-surface` activity carries the WHOLE generative-UI lifecycle on one
 * stable messageId: pre-paint `status` ("building" | "retrying" | "failed")
 * with recovery detail, then `a2ui_operations` on paint. Core's
 * `ɵA2UIActivityController` decides what shows; this renderer draws it and
 * keeps the surface mounted, hidden under the loader, until it has painted.
 */
export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): VueActivityMessageRenderer<any> {
  const loadingComponent = isComponent(options.loadingComponent)
    ? options.loadingComponent
    : undefined;

  return {
    activityType: ɵA2UI_SURFACE_ACTIVITY_TYPE,
    content: ɵA2UI_SURFACE_CONTENT_SCHEMA,
    render: defineComponent({
      name: "A2UIMessageRendererHost",
      props: {
        activityType: { type: String, required: true },
        content: {
          type: Object as PropType<ɵA2UISurfaceContent>,
          required: true,
        },
        message: { type: Object as PropType<ActivityMessage>, required: true },
        agent: {
          type: Object as PropType<ɵA2UIActionAgent>,
          required: false,
          default: undefined,
        },
      },
      setup(props) {
        const controller = new ɵA2UIActivityController({
          recovery: options.recovery,
          warn:
            process.env.NODE_ENV !== "production"
              ? (message) => console.warn(message)
              : undefined,
        });
        const snapshot = shallowRef(controller.getSnapshot());
        const unsubscribe = controller.subscribe(() => {
          snapshot.value = controller.getSnapshot();
        });
        watch(
          () => props.content,
          (content) => controller.setContent(content),
          { immediate: true },
        );
        onBeforeUnmount(() => {
          unsubscribe();
          controller.dispose();
        });
        const markRendered = () => controller.markRendered();

        return () => {
          const current = snapshot.value;
          if (current.view === "lifecycle") {
            return renderA2UILifecycleState(current, loadingComponent);
          }

          const handingOff = current.view === "handoff";
          return h("div", { style: { position: "relative" } }, [
            // The surface stays mounted in the same place across the
            // hand-off; only its wrapper styling changes, so what painted
            // while hidden is kept.
            h(
              "div",
              {
                "aria-hidden": handingOff ? "true" : undefined,
                style: handingOff
                  ? {
                      position: "absolute",
                      inset: "0",
                      opacity: 0,
                      pointerEvents: "none",
                    }
                  : undefined,
              },
              [
                h(A2UISurfaceActivityRenderer, {
                  activityType: ɵA2UI_SURFACE_ACTIVITY_TYPE,
                  content: { operations: current.operations },
                  message: props.message,
                  agent: props.agent,
                  theme: options.theme,
                  catalog: options.catalog,
                  onAction: options.onAction,
                  onRendered: markRendered,
                }),
              ],
            ),
            handingOff
              ? renderA2UILifecycleState(current, loadingComponent)
              : null,
          ]);
        };
      },
    }),
  };
}
