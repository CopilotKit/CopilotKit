/**
 * Vue-native A2UI Surface renderer.
 *
 * Replaces the React island pattern with Vue components that use
 * @a2ui/web_core's framework-agnostic primitives directly.
 */

import {
  defineComponent,
  h,
  ref,
  watch,
  onBeforeUnmount,
  computed,
  type PropType,
  type VNode,
} from "vue";
import {
  ComponentContext,
  type SurfaceModel,
  type ComponentModel,
  type Subscription,
} from "@a2ui/web_core/v0_9";
import type { VueComponentImplementation } from "./adapter";

/**
 * DeferredChild — Vue equivalent of the React DeferredChild.
 * Subscribes to component create/delete events and renders the
 * appropriate catalog component via the GenericBinder adapter.
 */
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

    let sub1: Subscription | null = null;
    let sub2: Subscription | null = null;

    function teardownSubscriptions() {
      if (sub1) {
        sub1.unsubscribe();
        sub1 = null;
      }
      if (sub2) {
        sub2.unsubscribe();
        sub2 = null;
      }
    }

    function setupSubscriptions() {
      teardownSubscriptions();
      sub1 = props.surface.componentsModel.onCreated.subscribe(
        (comp: ComponentModel) => {
          if (comp.id === props.id) {
            version.value++;
          }
        },
      );
      sub2 = props.surface.componentsModel.onDeleted.subscribe(
        (delId: string) => {
          if (delId === props.id) {
            version.value++;
          }
        },
      );
    }

    setupSubscriptions();

    watch(
      () => [props.surface, props.id] as const,
      () => {
        setupSubscriptions();
      },
    );

    onBeforeUnmount(teardownSubscriptions);

    const context = computed(() => {
      return new ComponentContext(props.surface, props.id, props.basePath);
    });

    function buildChild(childId: string, specificPath?: string): VNode {
      const path = specificPath || props.basePath;
      return h(DeferredChild, {
        key: `${childId}-${path}`,
        surface: props.surface,
        id: childId,
        basePath: path,
      });
    }

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
          innerHTML: `<style>@keyframes a2ui-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }</style>`,
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

      return h(compImpl.render, {
        context: context.value,
        buildChild,
      });
    };
  },
});

/**
 * A2uiSurface — renders the root of a single A2UI surface.
 * The root component always has ID 'root' and base path '/'.
 */
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
