import type { Type } from "@angular/core";
import {
  child as sharedChild,
  childList as sharedChildList,
  createGenerativeUI as createSharedGenerativeUI,
} from "@copilotkit/shared/generative-ui";
import type {
  AnyGenerativeUI,
  CreateGenerativeUIConfig as SharedCreateGenerativeUIConfig,
  GenerativeUI as SharedGenerativeUI,
  GenerativeUIBasesDefinitions,
  GenerativeUIComponentDefinition as SharedGenerativeUIComponentDefinition,
  GenerativeUIComponentProps as SharedGenerativeUIComponentProps,
  GenerativeUIDefinitions,
  GenerativeUIFunctionDefinition,
  GenerativeUIResultDefinitions,
  GenerativeUISchema,
  ResolvedGenerativeUIComponent as SharedResolvedGenerativeUIComponent,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUIChildren } from "./children";

// The catalog is framework-free and lives in `@copilotkit/shared/generative-ui`.
// These types pin its component type to Angular component classes and its
// rendered child type to `GenerativeUIChildren`, the handle that
// `*copilotGenerativeUIChildren` renders.

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
} from "@copilotkit/shared/generative-ui";

/** One component of a generative UI, as the renderer reads it. */
export type GenerativeUIComponentDefinition =
  SharedGenerativeUIComponentDefinition<Type<unknown>>;

/** A component after `createGenerativeUI` resolved its bindings. */
export type ResolvedGenerativeUIComponent = SharedResolvedGenerativeUIComponent<
  Type<unknown>
>;

/**
 * Experimental. The result of `createGenerativeUI`: the components the model
 * can render, the app state they read, and the functions they call. Give it
 * to `provideGenerativeUI({ ui })` and to the typed helpers.
 */
export type GenerativeUI<
  Definitions extends GenerativeUIDefinitions = GenerativeUIDefinitions,
> = SharedGenerativeUI<Definitions, Type<unknown>>;

/**
 * The values that the renderer gives the inputs of a component:
 * `GenerativeUIComponentInputs<typeof ui, "ProductCard">`. Data props are
 * the parsed `props` schema, bound props included; a writable prop is a
 * `model()` of the component, which the renderer binds two-way. Event
 * inputs hold a handler only when the event is bound. Slot inputs and
 * `child()`/`childList()` props hold a `GenerativeUIChildren` handle.
 */
export type GenerativeUIComponentInputs<
  UI extends AnyGenerativeUI,
  Name extends keyof NonNullable<UI["definitions"]>["components"] & string,
> = SharedGenerativeUIComponentProps<UI, Name, GenerativeUIChildren>;

/** One new Angular component for each component of the bases that it names. */
type OverridesConfig<Bases extends readonly AnyGenerativeUI[]> = {
  [Name in keyof GenerativeUIBasesDefinitions<Bases>["components"] & string]?: {
    component: Type<unknown>;
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
 * they read, and the functions they call. A prop named like a top-level
 * state key is bound to it, `bind` binds a prop to a selector, an event binds
 * to the function with its name (or the name without `on`), and
 * `writable: ["value"]` makes `value` a two-way binding.
 *
 * @example
 * ```ts
 * export const ui = createGenerativeUI({
 *   id: "acme/store@1",
 *   extends: [standardUI],
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
  Bases extends readonly AnyGenerativeUI[] = [],
  State extends Record<string, GenerativeUISchema> = {},
  Functions extends Record<string, GenerativeUIFunctionDefinition> = {},
  Props extends Record<string, unknown> = {},
  Events extends Record<string, unknown> = {},
  Slots extends Record<string, unknown> = {},
  Writable extends Record<string, unknown> = {},
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
  // The Angular config only narrows the shared one (component classes), so
  // the shared runtime builds the same UI.
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

/**
 * One component id. The component gets a `GenerativeUIChildren` handle in
 * its place, to render with `*copilotGenerativeUIChildren`. Pass the
 * description here, not with `.describe()`, which would replace the mark.
 */
export function child(description?: string) {
  return sharedChild<GenerativeUIChildren>(description);
}

/**
 * A list of component ids, or a template `{ componentId, path }` that
 * repeats one component for each item of the list at `path`. The component
 * gets one `GenerativeUIChildren` handle for the whole list.
 */
export function childList(description?: string) {
  return sharedChildList<GenerativeUIChildren>(description);
}
