import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import type { Component, PropType } from "vue";
import { z } from "zod";
import type { VueActivityMessageRenderer } from "../types";
import type { A2UITheme } from "./types";
import A2UISurfaceActivityRenderer from "./A2UISurfaceActivityRenderer.vue";
import {
  A2UILifecycleFields,
  A2UIBuildingState,
  A2UIRetryingState,
  A2UIRecoveryFailure,
  resolveDebugExposure,
} from "./A2UIRecoveryStates";
import type { A2UIRecoveryRendererOptions } from "./A2UIRecoveryStates";
import { getOperationSurfaceId } from "./operations";

const A2UI_OPERATIONS_KEY = "a2ui_operations";
const DEFAULT_SURFACE_ID = "default";

export type A2UIUserAction = {
  name: string;
  sourceComponentId: string;
  surfaceId: string;
  timestamp: string;
  context?: Record<string, unknown>;
  dataContextPath?: string;
};

export type A2UIActionInterceptor = (
  action: A2UIUserAction,
  forward: (action?: A2UIUserAction) => Promise<void>,
) => void | A2UIUserAction | null | Promise<void | A2UIUserAction | null>;

export type A2UIMessageRendererOptions = {
  theme: A2UITheme;
  catalog?: any;
  loadingComponent?: Component;
  recovery?: A2UIRecoveryRendererOptions;
  onAction?: A2UIActionInterceptor;
};

const A2UISurfaceContentSchema = z
  .object({
    a2ui_operations: z.array(z.any()).optional(),
    ...A2UILifecycleFields,
  })
  .passthrough();

export type A2UIClientEventMessage = {
  userAction?: A2UIUserAction;
  [key: string]: unknown;
};

export async function runA2UIAction({
  message,
  agent,
  copilotkit,
  onAction,
}: {
  message: A2UIClientEventMessage;
  agent: any;
  copilotkit: any;
  onAction?: A2UIActionInterceptor;
}): Promise<void> {
  if (!agent) return;

  const action = message.userAction;

  const forward = async (forwardAction?: A2UIUserAction) => {
    const a2uiAction =
      forwardAction !== undefined
        ? { ...message, userAction: forwardAction }
        : message;
    try {
      copilotkit.setProperties({
        ...copilotkit.properties,
        a2uiAction,
      });
      await copilotkit.runAgent({ agent });
    } finally {
      if (copilotkit.properties) {
        const { a2uiAction: _omit, ...rest } = copilotkit.properties;
        copilotkit.setProperties(rest);
      }
    }
  };

  if (onAction && action) {
    const result = await onAction(action, forward);
    if (result === null) return;
    if (result) {
      await forward(result);
      return;
    }
  }

  await forward();
}

export function surfaceHasRenderableContent(operations: any[]): boolean {
  const componentOps = operations.filter((o) => o?.updateComponents);
  if (!componentOps.length) return false;
  const needsData = JSON.stringify(componentOps).includes('"path"');
  if (!needsData) return true;
  return operations.some((o) => {
    const v = o?.updateDataModel?.value;
    if (!v || typeof v !== "object") return false;
    return Object.values(v).some((x) =>
      Array.isArray(x)
        ? x.length > 0
        : x !== null && x !== undefined && x !== "",
    );
  });
}

export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): VueActivityMessageRenderer<any> {
  const { theme, catalog, loadingComponent, recovery, onAction } = options;
  const showAfterMs = recovery?.showAfterMs ?? 2000;
  const showAfterAttempts = recovery?.showAfterAttempts ?? 2;
  const optionDebugExposure = recovery?.debugExposure ?? "collapsed";

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
        const operations = ref<any[]>([]);
        const lastContentRef = shallowRef<unknown>(null);
        const lastLoaderContentRef = shallowRef<any>(null);
        const surfaceReady = ref(false);
        const readyRef = ref(false);
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        let revealFrame: number | null = null;

        watch(
          () => props.content,
          (content) => {
            if (content === lastContentRef.value) return;
            lastContentRef.value = content;

            const incoming = content?.[A2UI_OPERATIONS_KEY];
            if (!content || !Array.isArray(incoming)) {
              operations.value = [];
              return;
            }
            operations.value = incoming;
          },
          { immediate: true, deep: false },
        );

        const groupedOperations = computed(() => {
          const groups = new Map<string, any[]>();
          for (const operation of operations.value) {
            const surfaceId =
              getOperationSurfaceId(operation) ?? DEFAULT_SURFACE_ID;
            if (!groups.has(surfaceId)) {
              groups.set(surfaceId, []);
            }
            groups.get(surfaceId)!.push(operation);
          }
          return groups;
        });

        const hasOps = computed(() => groupedOperations.value.size > 0);

        const contentHasOps = computed(
          () =>
            Array.isArray(props.content?.[A2UI_OPERATIONS_KEY]) &&
            props.content[A2UI_OPERATIONS_KEY].length > 0,
        );

        watch(
          contentHasOps,
          (value) => {
            if (!value) {
              lastLoaderContentRef.value = props.content;
            }
          },
          { immediate: true },
        );

        function clearTimers() {
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          if (revealFrame !== null) {
            cancelAnimationFrame(revealFrame);
            revealFrame = null;
          }
        }

        function markSurfaceReady() {
          if (readyRef.value) return;
          readyRef.value = true;
          revealFrame = requestAnimationFrame(() => {
            surfaceReady.value = true;
            revealFrame = null;
          });
        }

        watch(
          hasOps,
          (value) => {
            clearTimers();
            if (!value) {
              surfaceReady.value = false;
              readyRef.value = false;
              return;
            }
            fallbackTimer = setTimeout(() => {
              surfaceReady.value = true;
            }, 8000);
          },
          { immediate: true },
        );

        onBeforeUnmount(() => {
          clearTimers();
        });

        function renderLifecycle(c: any) {
          const status = c?.status;
          const debugExposure = resolveDebugExposure(c, optionDebugExposure);
          if (status === "failed") {
            return h(A2UIRecoveryFailure, { content: c, debugExposure });
          }
          if (status === "retrying") {
            return h(A2UIRetryingState, {
              content: c,
              showAfterMs,
              showAfterAttempts,
              debugExposure,
            });
          }
          if (loadingComponent) {
            return h(loadingComponent);
          }
          return h(A2UIBuildingState, { content: c });
        }

        return () => {
          if (!hasOps.value) {
            return renderLifecycle(props.content);
          }

          const surfaces = h(
            "div",
            {
              class:
                "cpk:flex cpk:min-h-0 cpk:flex-1 cpk:flex-col cpk:gap-6 cpk:overflow-auto cpk:py-6",
            },
            Array.from(groupedOperations.value.entries()).map(
              ([surfaceId, ops]) =>
                h(A2UISurfaceActivityRenderer, {
                  key: surfaceId,
                  activityType: "a2ui-surface",
                  content: { operations: ops },
                  message: props.message,
                  agent: props.agent,
                  theme,
                  catalog,
                  onAction,
                  onReady: markSurfaceReady,
                  surfaceId,
                }),
            ),
          );

          return h("div", { style: { position: "relative" } }, [
            h(
              "div",
              {
                "aria-hidden": !surfaceReady.value,
                style: surfaceReady.value
                  ? undefined
                  : {
                      position: "absolute",
                      inset: "0",
                      opacity: "0",
                      pointerEvents: "none",
                    },
              },
              [surfaces],
            ),
            !surfaceReady.value
              ? renderLifecycle(lastLoaderContentRef.value ?? props.content)
              : null,
          ]);
        };
      },
    }),
  };
}
