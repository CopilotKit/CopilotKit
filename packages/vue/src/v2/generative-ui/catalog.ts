import type { Component, VNode } from "vue";
import { createGenerativeUI as createSharedGenerativeUI } from "@copilotkit/shared/generative-ui";
import type {
  AnyGenerativeUI,
  CreateGenerativeUIConfig as SharedCreateGenerativeUIConfig,
  GenerativeUI as SharedGenerativeUI,
  GenerativeUIBasesDefinitions,
  GenerativeUIComponentDefinition as SharedGenerativeUIComponentDefinition,
  GenerativeUIComponentProps as SharedGenerativeUIComponentProps,
  GenerativeUIDefinitions,
  GenerativeUIDefinitionsOf,
  GenerativeUIFunctionDefinition,
  GenerativeUIResultDefinitions,
  GenerativeUISchema,
  ResolvedGenerativeUIComponent as SharedResolvedGenerativeUIComponent,
} from "@copilotkit/shared/generative-ui";

// The catalog is framework-free and lives in `@copilotkit/shared/generative-ui`.
// These types pin its component type to Vue components and its rendered
// child type to `VNode`. A Vue component gets slots as Vue slots and each
// writable prop as a `v-model` (a prop plus an `update:<key>` emit), so the
// props type drops the shared slot props and setters.

export {
  catalogIdsOf,
  componentCatalogIds,
  setterNameOf,
} from "@copilotkit/shared/generative-ui";
export type {
  GenerativeUIComponentName,
  GenerativeUIDefinitionsOf,
  GenerativeUIEventDefinition,
  GenerativeUIEventInput,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionDefinition,
  GenerativeUIFunctionInput,
  GenerativeUIFunctionName,
  GenerativeUIFunctionsOf,
  GenerativeUISelector,
  GenerativeUISlotKind,
  GenerativeUIStateOf,
  PropsSchema,
  UnionToIntersection,
} from "@copilotkit/shared/generative-ui";

/** One component of a generative UI, as the renderer reads it. */
export type GenerativeUIComponentDefinition =
  SharedGenerativeUIComponentDefinition<Component>;

/** A component after `createGenerativeUI` resolved its bindings. */
export type ResolvedGenerativeUIComponent =
  SharedResolvedGenerativeUIComponent<Component>;

/**
 * Experimental. The result of `createGenerativeUI`: the components the model
 * can render, the app state they read, and the functions they call. Give it
 * to the provider (`:generativeUI="{ ui }"`) and to the typed composables.
 */
export type GenerativeUI<
  Definitions extends GenerativeUIDefinitions = GenerativeUIDefinitions,
> = SharedGenerativeUI<Definitions, Component>;

/** A component name of `UI`, as the component types take it. */
type ComponentNameOf<UI extends AnyGenerativeUI> =
  keyof GenerativeUIDefinitionsOf<UI>["components"] & string;

/** The type-level data of one component of `UI`. */
type ComponentTypesOf<
  UI extends AnyGenerativeUI,
  Name extends ComponentNameOf<UI>,
> = GenerativeUIDefinitionsOf<UI>["components"][Name];

/** The shared props, with rendered children as `VNode`s. */
type SharedProps<
  UI extends AnyGenerativeUI,
  Name extends ComponentNameOf<UI>,
> = SharedGenerativeUIComponentProps<UI, Name, VNode>;

// The shared package does not export its slot and writable key helpers
// (`SlotProps`, `WritableKeys`), so these two rebuild the keys from the
// component types the same way.

/** The slot names of a component. None for a component without `slots`. */
type SlotKeysOf<UI extends AnyGenerativeUI, Name extends ComponentNameOf<UI>> =
  ComponentTypesOf<UI, Name>["slots"] extends Record<string, unknown>
    ? keyof ComponentTypesOf<UI, Name>["slots"] & string
    : never;

/** The writable keys of a component. None for a component without `writable`. */
type WritableKeysOf<
  UI extends AnyGenerativeUI,
  Name extends ComponentNameOf<UI>,
> = ComponentTypesOf<UI, Name>["writable"] extends readonly (infer Key)[]
  ? Key & string
  : never;

/** The shared setter prop of a writable key: `value` gives `setValue`. */
type SetterKey<Key extends string> = `set${Capitalize<Key>}`;

/** The emit arguments of a shared setter: `[value: Value]`. */
type SetterArgs<Setter> = Setter extends (value: infer Value) => void
  ? [value: Value]
  : never;

/**
 * Props that the renderer passes to a Vue component. Mirrors React's
 * `GenerativeUIComponentProps`, with two Vue changes:
 *
 * - A writable prop is a plain prop. Its setter is the `update:<key>` emit
 *   of `GenerativeUIComponentEmits`, so `defineModel` works.
 * - Slots are Vue slots. See `GenerativeUIComponentSlots`.
 *
 * Data props are the parsed `props` schema, bound props included, with each
 * `child()` / `childList()` as a `VNode`. Event props are present only when
 * the event is bound.
 *
 * Two limits of Vue's type tools:
 *
 * - Type a `defineComponent` or SFC from a UI that does not list it, such as
 *   the base of an override. Typed from its own UI, it is a circular type.
 *   A function component can type itself from its own UI, as in React.
 * - The SFC compiler cannot read this type in `defineProps` or
 *   `defineEmits`. Write the prop names, and index the type for each one.
 *   `defineSlots` and `defineModel` take the types as they are.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import type {
 *   GenerativeUIComponentProps,
 *   GenerativeUIComponentSlots,
 * } from "@copilotkit/vue/v2/generative-ui";
 * import type { shopUI } from "./shop-ui";
 *
 * type Props = GenerativeUIComponentProps<typeof shopUI, "ProductCard">;
 *
 * const props = defineProps<{
 *   name: Props["name"];
 *   onAddToCart?: Props["onAddToCart"];
 * }>();
 * // `quantity` is writable: a `v-model` the renderer binds.
 * const quantity = defineModel<Props["quantity"]>("quantity", { required: true });
 * defineSlots<GenerativeUIComponentSlots<typeof shopUI, "ProductCard">>();
 * </script>
 *
 * <template>
 *   <article>
 *     <h3>{{ props.name }}</h3>
 *     <input v-model.number="quantity" type="number" />
 *     <button @click="props.onAddToCart?.({ quantity })">Add</button>
 *     <slot name="footer" />
 *   </article>
 * </template>
 * ```
 */
export type GenerativeUIComponentProps<
  UI extends AnyGenerativeUI,
  Name extends ComponentNameOf<UI>,
> = Omit<
  SharedProps<UI, Name>,
  SlotKeysOf<UI, Name> | SetterKey<WritableKeysOf<UI, Name>>
>;

/**
 * The emits of a Vue component, for `defineEmits`: one `update:<key>` event
 * for each writable prop, with the schema input as its value. React passes
 * the same value to the `set<Key>` setter prop.
 */
export type GenerativeUIComponentEmits<
  UI extends AnyGenerativeUI,
  Name extends ComponentNameOf<UI>,
> = {
  [Key in WritableKeysOf<UI, Name> as SetterKey<Key> extends keyof SharedProps<
    UI,
    Name
  >
    ? `update:${Key}`
    : never]: SetterArgs<
    SharedProps<UI, Name>[SetterKey<Key> & keyof SharedProps<UI, Name>]
  >;
};

/**
 * The slots of a Vue component, for `defineSlots`: one slot for each key of
 * its `slots`. A "single" slot renders its child, a "multiple" slot returns
 * one `VNode` for each child. A slot is present only when it is filled.
 * React passes the same children as slot props.
 */
export type GenerativeUIComponentSlots<
  UI extends AnyGenerativeUI,
  Name extends ComponentNameOf<UI>,
> = {
  [Key in SlotKeysOf<UI, Name>]?: () => VNode[];
};

/**
 * One new Vue component for each component of the bases that it names. Vue
 * component types do not carry a props type that TypeScript can check here,
 * so any Vue component fits, as in Angular.
 */
type OverridesConfig<Bases extends readonly AnyGenerativeUI[]> = {
  [Name in keyof GenerativeUIBasesDefinitions<Bases>["components"] & string]?: {
    component: Component;
  };
};

/** The config of `createGenerativeUI`. */
export type CreateGenerativeUIConfig<
  Bases extends readonly AnyGenerativeUI[],
  State extends Record<string, GenerativeUISchema>,
  Functions extends Record<string, GenerativeUIFunctionDefinition>,
  Props extends Record<string, unknown>,
  Events extends Record<string, unknown>,
  Slots extends Record<string, unknown>,
  Writable extends Record<string, unknown>,
> = SharedCreateGenerativeUIConfig<
  Bases,
  State,
  Functions,
  Props,
  Events,
  Slots,
  Writable,
  OverridesConfig<Bases>
>;

/**
 * Experimental. Declares the components the model can render, the app state
 * they read, and the functions they call. Mirrors React's
 * `createGenerativeUI`.
 *
 * - A prop with the name of a top-level state key is bound to that state.
 * - `bind: { prop: (state, props) => value }` binds a prop to a selector.
 * - An event binds to the function with its name, else to the name without
 *   `on` (`onAddToCart` calls `addToCart`).
 * - `writable: ["value"]` makes `value` a `v-model`: the component gets a
 *   `value` prop and emits `update:value`.
 *
 * The model does not see bound props or matched events.
 *
 * @param config - `id`, then optional `extends`, `state`, `functions` and
 *   `overrides`, then `components`. Put `state` before `components`, so the
 *   selectors get typed state.
 * @throws Error when the config is not valid, with the same checks as
 *   React's `createGenerativeUI`: a name from two places, an unknown
 *   override, a reserved or repeated key, an unmatched event without
 *   `parameters`, or a `bind` or `writable` key that is not a valid prop.
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({
 *   id: "acme/store@1",
 *   state: { cart: cartSchema },
 *   functions: { addToCart: { parameters: z.object({ productId: z.string() }) } },
 *   components: {
 *     CartSummary: {
 *       component: CartSummary,
 *       props: z.object({ count: z.number() }),
 *       bind: { count: (state) => state.cart.count },
 *     },
 *   },
 * });
 * ```
 */
export function createGenerativeUI<
  // The `{}` defaults mirror the shared `createGenerativeUI`.
  /* eslint-disable @typescript-eslint/no-empty-object-type */
  Bases extends readonly AnyGenerativeUI[] = [],
  State extends Record<string, GenerativeUISchema> = {},
  Functions extends Record<string, GenerativeUIFunctionDefinition> = {},
  Props extends Record<string, unknown> = {},
  Events extends Record<string, unknown> = {},
  Slots extends Record<string, unknown> = {},
  Writable extends Record<string, unknown> = {},
  /* eslint-enable @typescript-eslint/no-empty-object-type */
>(
  config: CreateGenerativeUIConfig<
    Bases,
    State,
    Functions,
    Props,
    Events,
    Slots,
    Writable
  >,
) {
  // The Vue config only narrows the shared one (Vue component types), so
  // the shared runtime builds the same UI. Same delegation as React.
  const build = createSharedGenerativeUI as (config: unknown) => unknown;
  return build(config) as GenerativeUI<
    GenerativeUIResultDefinitions<
      Bases,
      State,
      Functions,
      Props,
      Events,
      Slots,
      Writable
    >
  >;
}
