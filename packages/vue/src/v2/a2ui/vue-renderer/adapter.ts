/**
 * Vue adapter for @a2ui/web_core v0.9 component rendering.
 */

import { defineComponent, onUnmounted, shallowRef, watch } from "vue";
import type { PropType, VNode } from "vue";
import type { ComponentContext } from "@a2ui/web_core/v0_9";
import { GenericBinder } from "@a2ui/web_core/v0_9";
import type {
  ComponentApi,
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";

/** Props passed to a Vue A2UI component's render function. */
export interface VueA2uiComponentProps<T, S = void> {
  props: T;
  buildChild: (id: string, basePath?: string) => VNode;
  context: ComponentContext;
  state: S;
}

/** A Vue component implementation registered with the A2UI Catalog. */
export interface VueComponentImplementation extends ComponentApi {
  render: ReturnType<typeof defineComponent>;
}

export function createVueComponent<Api extends ComponentApi, S = void>(
  api: Api,
  renderFn: (
    componentProps: VueA2uiComponentProps<
      ResolveA2uiProps<InferredComponentApiSchemaType<Api>>,
      S
    >,
  ) => VNode | VNode[] | null,
  setupState?: () => S,
): VueComponentImplementation {
  type Props = ResolveA2uiProps<InferredComponentApiSchemaType<Api>>;

  const VueWrapper = defineComponent({
    name: `A2UI_${api.name}`,
    props: {
      context: {
        type: Object as PropType<ComponentContext>,
        required: true,
      },
      buildChild: {
        type: Function as PropType<(id: string, basePath?: string) => VNode>,
        required: true,
      },
    },
    setup(wrapperProps) {
      const resolvedProps = shallowRef<Props>({} as Props);
      let binder: GenericBinder<Props> | null = null;
      let unsubscribe: (() => void) | null = null;
      const state = setupState ? setupState() : (undefined as S);

      function disposeBinder() {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (binder) {
          binder.dispose();
          binder = null;
        }
      }

      function initBinder(context: ComponentContext) {
        disposeBinder();
        binder = new GenericBinder<Props>(context, api.schema);
        resolvedProps.value = binder.snapshot;
        const sub = binder.subscribe((newProps: Props) => {
          resolvedProps.value = newProps;
        });
        unsubscribe = () => sub.unsubscribe();
      }

      initBinder(wrapperProps.context);

      watch(
        () => wrapperProps.context,
        (newContext, oldContext) => {
          if (newContext === oldContext) return;
          initBinder(newContext);
        },
      );

      onUnmounted(() => {
        disposeBinder();
      });

      return () =>
        renderFn({
          props: resolvedProps.value,
          buildChild: wrapperProps.buildChild,
          context: wrapperProps.context,
          state,
        });
    },
  });

  return {
    name: api.name,
    schema: api.schema,
    render: VueWrapper,
  };
}

export function createBinderlessVueComponent(
  api: ComponentApi,
  renderFn: (componentProps: {
    context: ComponentContext;
    buildChild: (id: string, basePath?: string) => VNode;
  }) => VNode | VNode[] | null,
): VueComponentImplementation {
  const VueWrapper = defineComponent({
    name: `A2UI_${api.name}`,
    props: {
      context: {
        type: Object as PropType<ComponentContext>,
        required: true,
      },
      buildChild: {
        type: Function as PropType<(id: string, basePath?: string) => VNode>,
        required: true,
      },
    },
    setup(wrapperProps) {
      return () =>
        renderFn({
          context: wrapperProps.context,
          buildChild: wrapperProps.buildChild,
        });
    },
  });

  return {
    name: api.name,
    schema: api.schema,
    render: VueWrapper,
  };
}
