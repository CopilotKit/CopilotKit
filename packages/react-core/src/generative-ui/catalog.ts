import type { ComponentType, ReactNode } from "react";
import { createGenerativeUI as createSharedGenerativeUI } from "@copilotkit/shared/generative-ui";
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

// The catalog is framework-free and lives in `@copilotkit/shared/generative-ui`.
// These types pin its component type to React components and its rendered
// child type to `ReactNode`.

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
  SharedGenerativeUIComponentDefinition<ComponentType<any>>;

/** A component after `createGenerativeUI` resolved its bindings. */
export type ResolvedGenerativeUIComponent = SharedResolvedGenerativeUIComponent<
  ComponentType<any>
>;

/**
 * Experimental. The result of `createGenerativeUI`: the components the model
 * can render, the app state they read, and the functions they call. Give it
 * to the provider (`generativeUI={{ ui }}`) and to the typed hooks.
 */
export type GenerativeUI<
  Definitions extends GenerativeUIDefinitions = GenerativeUIDefinitions,
> = SharedGenerativeUI<Definitions, ComponentType<any>>;

/**
 * Props that the renderer passes to a component:
 * `function CheckoutForm(props: GenerativeUIComponentProps<typeof ui, "CheckoutForm">)`.
 * Data props are the parsed `props` schema, bound props included. Event and
 * slot props are present only when they are bound or filled. Each writable
 * prop gets a setter (`value` gets `setValue`), which is always present.
 */
export type GenerativeUIComponentProps<
  UI extends AnyGenerativeUI,
  Name extends keyof NonNullable<UI["definitions"]>["components"] & string,
> = SharedGenerativeUIComponentProps<UI, Name, ReactNode>;

/** One new React component for each component of the bases that it names. */
type OverridesConfig<Bases extends readonly AnyGenerativeUI[]> = {
  [Name in keyof GenerativeUIBasesDefinitions<Bases>["components"] & string]?: {
    component: ComponentType<
      GenerativeUIBasesDefinitions<Bases> extends infer Definitions extends
        GenerativeUIDefinitions
        ? GenerativeUIComponentProps<GenerativeUI<Definitions>, Name>
        : never
    >;
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
 * they read, and the functions they call.
 *
 * - A prop with the name of a top-level state key is bound to that state.
 * - `bind: { prop: (state, props) => value }` binds a prop to a selector.
 * - An event binds to the function with its name, else to the name without
 *   `on` (`onAddToCart` calls `addToCart`).
 * - `writable: ["value"]` gives the component a `setValue` prop. See
 *   `GenerativeUIComponentDefinition.writable`.
 *
 * The model does not see bound props or matched events.
 *
 * @param config - `id`, then optional `extends`, `state`, `functions` and
 *   `overrides`, then `components`. Put `state` before `components`, so the selectors
 *   get typed state.
 * @throws Error when a name comes from two places, an override names no
 *   component of the bases, `props` is not an object
 *   schema with a JSON Schema, a key is reserved or used
 *   twice on a component, an event matches two functions, an unmatched event
 *   has no `parameters`, a `bind` key is not a prop, a `writable` key is not
 *   a prop or is a bound prop, or a setter name is already a key of the
 *   component. Also throws when `parameterOrder` contains duplicate or unknown
 *   keys, or an ordered component declares integer-index keys whose JSON object
 *   enumeration order cannot be controlled.
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
  // The React config only narrows the shared one (React component types),
  // so the shared runtime builds the same UI.
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
