/**
 * Vue-native A2UI Surface renderer.
 */

import { defineComponent, h, onUnmounted, ref, shallowRef, watch } from "vue";
import type { PropType, VNode } from "vue";
import type { ComponentModel, SurfaceModel } from "@a2ui/web_core/v0_9";
import { ComponentContext } from "@a2ui/web_core/v0_9";
import type { VueComponentImplementation } from "./adapter";

const ResolvedChild = defineComponent({
  name: "A2UIResolvedChild",
  props: {
    surface: {
      type: Object as PropType<SurfaceModel<VueComponentImplementation>>,
      required: true,
    },
    id: { type: String, required: true },
    basePath: { type: String, required: true },
    componentModel: {
      type: Object as PropType<ComponentModel>,
      required: true,
    },
    compImpl: {
      type: Object as PropType<VueComponentImplementation>,
      required: true,
    },
  },
  setup(props) {
    const context = shallowRef<ComponentContext | null>(null);

    watch(
      () =>
        [
          props.surface,
          props.id,
          props.basePath,
          props.componentModel,
        ] as const,
      () => {
        context.value = new ComponentContext(
          props.surface,
          props.id,
          props.basePath,
        );
      },
      { immediate: true },
    );

    function buildChild(childId: string, specificPath?: string): VNode {
      const path =
        specificPath ?? context.value?.dataContext.path ?? props.basePath;
      return h(DeferredChild, {
        key: `${childId}-${path}`,
        surface: props.surface,
        id: childId,
        basePath: path,
      });
    }

    return () => {
      if (!context.value) return null;
      return h(props.compImpl.render, {
        context: context.value,
        buildChild,
      });
    };
  },
});

const DeferredChild = defineComponent({
  name: "A2UIDeferredChild",
  props: {
    surface: {
      type: Object as PropType<SurfaceModel<VueComponentImplementation>>,
      required: true,
    },
    id: { type: String, required: true },
    basePath: { type: String, required: true },
  },
  setup(props) {
    const version = ref(0);
    let unsubCreate: (() => void) | null = null;
    let unsubDelete: (() => void) | null = null;

    function bindSubscriptions() {
      unsubCreate?.();
      unsubDelete?.();
      const sub1 = props.surface.componentsModel.onCreated.subscribe(
        (comp: ComponentModel) => {
          if (comp.id === props.id) {
            version.value++;
          }
        },
      );
      const sub2 = props.surface.componentsModel.onDeleted.subscribe(
        (delId: string) => {
          if (delId === props.id) {
            version.value++;
          }
        },
      );
      unsubCreate = () => sub1.unsubscribe();
      unsubDelete = () => sub2.unsubscribe();
    }

    watch(
      () => [props.surface, props.id] as const,
      () => {
        bindSubscriptions();
        version.value++;
      },
      { immediate: true },
    );

    onUnmounted(() => {
      unsubCreate?.();
      unsubDelete?.();
    });

    return () => {
      void version.value;

      const componentModel = props.surface.componentsModel.get(props.id);

      if (!componentModel) {
        return h("div", {
          style: {
            padding: "12px 16px",
            borderRadius: "8px",
            background:
              "linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)",
            backgroundSize: "200% 100%",
            animation: "a2ui-shimmer 1.5s ease-in-out infinite",
            minHeight: "2rem",
          },
          innerHTML:
            "<style>@keyframes a2ui-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }</style>",
        });
      }

      const compImpl = props.surface.catalog.components.get(
        componentModel.type,
      );

      if (!compImpl) {
        return h(
          "div",
          { style: { color: "red" } },
          `Unknown component: ${componentModel.type}`,
        );
      }

      return h(ResolvedChild, {
        surface: props.surface,
        id: props.id,
        basePath: props.basePath,
        componentModel,
        compImpl,
      });
    };
  },
});

export const A2uiSurface = defineComponent({
  name: "A2uiSurface",
  props: {
    surface: {
      type: Object as PropType<SurfaceModel<VueComponentImplementation>>,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h(DeferredChild, {
        surface: props.surface,
        id: "root",
        basePath: "/",
      });
  },
});

export { DeferredChild };
