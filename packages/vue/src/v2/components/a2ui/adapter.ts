/**
 * Vue adapter for @a2ui/web_core v0.9 component rendering.
 *
 * Provides createVueComponent — the Vue equivalent of createReactComponent
 * from the React renderer. Uses GenericBinder for reactive data binding
 * and Vue's render functions for component output.
 */

import {
  defineComponent,
  ref,
  onUnmounted,
  watch,
  type VNode,
  type PropType,
} from "vue";
import {
  ComponentContext,
  GenericBinder,
  type ComponentApi,
  type InferredComponentApiSchemaType,
  type ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";

/** Props passed to a Vue A2UI component's render function. */
export interface VueA2uiComponentProps<T, S = void> {
  props: T;
  buildChild: (id: string, basePath?: string) => VNode;
  context: ComponentContext;
  state: S;
}

/**
 * A Vue component implementation registered with the A2UI Catalog.
 * Mirrors ReactComponentImplementation but uses Vue's component system.
 */
export interface VueComponentImplementation extends ComponentApi {
  /** The Vue component that handles rendering. */
  render: ReturnType<typeof defineComponent>;
}

/**
 * Creates a Vue component implementation using the GenericBinder.
 * This is the Vue equivalent of createReactComponent from the React adapter.
 */
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
      const resolvedProps = ref<Props>({} as Props);
      let binder: GenericBinder<Props> | null = null;
      const state = setupState ? setupState() : (undefined as S);

      function initBinder(context: ComponentContext) {
        if (binder) {
          binder.dispose();
        }
        binder = new GenericBinder<Props>(context, api.schema);
        resolvedProps.value = binder.snapshot;
        binder.subscribe((newProps: Props) => {
          resolvedProps.value = newProps;
        });
      }

      initBinder(wrapperProps.context);

      watch(
        () => wrapperProps.context,
        (newContext) => {
          initBinder(newContext);
        },
      );

      onUnmounted(() => {
        if (binder) {
          binder.dispose();
          binder = null;
        }
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

/**
 * Creates a Vue component implementation without the generic binder
 * (for components that manage their own context bindings).
 */
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
