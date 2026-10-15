import type { ComponentType, ReactNode } from "react";
import { z } from "zod";
import type { GenerativeUIComponentManifest } from "@copilotkit/shared";
import type { GenerativeUIInvokeResult } from "./errors";
import { toJsonSchema } from "./json-schema";

export type GenerativeUISlotKind = "single" | "multiple";

/** A zod object schema for component props. */
export type PropsSchema = z.ZodObject<z.ZodRawShape>;

/** An event prop of a component. */
export interface GenerativeUIEventDefinition {
  description?: string;
  /**
   * Arguments the component passes when it calls the event prop. An event
   * that matches a declared function can leave this out. Then the function
   * parameters are used.
   */
  parameters?: z.ZodTypeAny;
}

/**
 * A function that generated UI can call. The handler comes from
 * `useGenerativeUIFunction`.
 */
export interface GenerativeUIFunctionDefinition {
  description?: string;
  parameters: z.ZodTypeAny;
}

/**
 * Gives a bound prop its value. It gets the full state and the parsed
 * model-set props of the node. It runs in the browser and must be pure.
 */
export type GenerativeUISelector = (
  state: Record<string, unknown>,
  props: Record<string, unknown>,
) => unknown;

/**
 * Method syntax makes the parameters bivariant. So a selector with typed
 * parameters fits this runtime type.
 */
type RuntimeSelector = {
  select(
    state: Record<string, unknown>,
    props: Record<string, unknown>,
  ): unknown;
}["select"];

/** One component of a generative UI, as the renderer reads it. */
export interface GenerativeUIComponentDefinition {
  component: ComponentType<any>;
  description?: string;
  /** All data props: the props the model sets and the bound props. */
  props?: PropsSchema;
  /** Explicit selectors for bound props. */
  bind?: Record<string, RuntimeSelector>;
  /** Callback props. */
  events?: Record<string, GenerativeUIEventDefinition>;
  /** Child props, filled with rendered child components. */
  slots?: Record<string, GenerativeUISlotKind>;
}

/** A component after `createGenerativeUI` resolved its bindings. */
export interface ResolvedGenerativeUIComponent extends GenerativeUIComponentDefinition {
  /**
   * One selector for each bound prop. A prop with the name of a top-level
   * state key reads `state[key]`. A `bind` entry wins over the name rule.
   */
  selectors: Record<string, GenerativeUISelector>;
  /** Event name to the name of the declared function it calls. */
  eventFunctions: Record<string, string>;
  /** `props` without the bound keys. The model sets these. */
  modelProps: PropsSchema;
  /** `props` with only the bound keys. Parses the selector results. */
  boundProps: PropsSchema;
}

/** Type-level data of one component, kept in `GenerativeUI["definitions"]`. */
export interface GenerativeUIComponentTypes {
  /** The `props` schema, or `unknown` when the component has none. */
  props: unknown;
  /** The `events` object, or `unknown` when the component has none. */
  events: unknown;
  /** The `slots` object, or `unknown` when the component has none. */
  slots: unknown;
}

/** Type-level data of a generative UI, with the keys of its bases merged in. */
export interface GenerativeUIDefinitions {
  state: Record<string, z.ZodTypeAny>;
  functions: Record<string, GenerativeUIFunctionDefinition>;
  components: Record<string, GenerativeUIComponentTypes>;
}

/**
 * Experimental. The result of `createGenerativeUI`: the components the model
 * can render, the app state they read, and the functions they call. Give it
 * to the provider (`generativeUI={{ ui }}`) and to the typed hooks.
 */
export interface GenerativeUI<
  Definitions extends GenerativeUIDefinitions = GenerativeUIDefinitions,
> {
  /** Surfaces pin to this id. */
  readonly id: string;
  /** State schemas, bases first. */
  readonly state: ReadonlyMap<string, z.ZodTypeAny>;
  /** Declared functions, bases first. */
  readonly functions: ReadonlyMap<string, GenerativeUIFunctionDefinition>;
  /** Components, bases first. */
  readonly components: ReadonlyMap<string, ResolvedGenerativeUIComponent>;
  /** What the model sees: model-set props and unmatched events only. */
  readonly manifestComponents: Record<string, GenerativeUIComponentManifest>;
  /** Type only, never set at runtime. */
  readonly definitions?: Definitions;
}

type AnyGenerativeUI = GenerativeUI<any>;

/**
 * Any function or class component. Unlike `ComponentType`, checking a value
 * against it does not read the component's props type. So a component can
 * type its props from `typeof ui` without a circular type reference.
 */
type AnyComponent =
  | ((...args: never) => unknown)
  | (abstract new (...args: never) => unknown);

type Simplify<T> = { [Key in keyof T]: T[Key] } & {};

/** `A | B` to `A & B`. */
export type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

type OutputOf<Schema> = Schema extends z.ZodTypeAny ? z.output<Schema> : never;
type InputOf<Schema> = Schema extends z.ZodTypeAny ? z.input<Schema> : never;
type ShapeOf<Props> = Props extends PropsSchema ? Props["shape"] : {};
type PropKeys<Props> = keyof ShapeOf<Props> & string;

/** The type-level data of a generative UI. */
export type GenerativeUIDefinitionsOf<UI extends AnyGenerativeUI> = NonNullable<
  UI["definitions"]
>;

type StateValues<State> = Simplify<{
  [Key in keyof State]: OutputOf<State[Key]>;
}>;

/**
 * The state object of a generative UI, bases included. Selectors get it, and
 * `useGenerativeUIState(ui, key, value)` sets one key of it.
 */
export type GenerativeUIStateOf<UI extends AnyGenerativeUI> = StateValues<
  GenerativeUIDefinitionsOf<UI>["state"]
>;

/** The declared functions of a generative UI, bases included. */
export type GenerativeUIFunctionsOf<UI extends AnyGenerativeUI> =
  GenerativeUIDefinitionsOf<UI>["functions"];

/** The name of a declared function of a generative UI. */
export type GenerativeUIFunctionName<UI extends AnyGenerativeUI> =
  keyof GenerativeUIFunctionsOf<UI> & string;

type FunctionInput<Functions, Name> = Name extends keyof Functions
  ? Functions[Name] extends GenerativeUIFunctionDefinition
    ? InputOf<Functions[Name]["parameters"]>
    : never
  : never;

/** What a caller passes to a declared function (the schema input). */
export type GenerativeUIFunctionInput<
  UI extends AnyGenerativeUI,
  Name extends GenerativeUIFunctionName<UI>,
> = FunctionInput<GenerativeUIFunctionsOf<UI>, Name>;

/**
 * What the handler of a declared function gets: the parsed arguments (the
 * schema output, with defaults set).
 */
export type GenerativeUIFunctionArgs<
  UI extends AnyGenerativeUI,
  Name extends GenerativeUIFunctionName<UI>,
> = OutputOf<GenerativeUIFunctionsOf<UI>[Name]["parameters"]>;

/**
 * The function an event calls: the function with the same name, else the
 * name without `on` and with a lowercase first letter. `never` when none.
 */
type MatchedFunction<
  Name extends string,
  Functions,
> = Name extends keyof Functions
  ? Name
  : Name extends `on${infer Rest}`
    ? Uncapitalize<Rest> extends keyof Functions
      ? Uncapitalize<Rest>
      : never
    : never;

/**
 * The argument type of an event prop. The event `parameters` input when it
 * declares them, else the input of the matched function.
 */
export type GenerativeUIEventInput<
  Name extends string,
  Event,
  Functions,
> = "parameters" extends keyof Event
  ? InputOf<Event["parameters" & keyof Event]>
  : FunctionInput<Functions, MatchedFunction<Name, Functions>>;

type DataProps<Props> = Props extends PropsSchema ? z.output<Props> : {};

type EventProps<Events, Functions> =
  Events extends Record<string, unknown>
    ? {
        [Name in keyof Events]?: (
          args: GenerativeUIEventInput<Name & string, Events[Name], Functions>,
        ) => Promise<GenerativeUIInvokeResult>;
      }
    : {};

type SlotProps<Slots> =
  Slots extends Record<string, unknown>
    ? { [Name in keyof Slots]?: ReactNode }
    : {};

/**
 * Props that the renderer passes to a component:
 * `function CheckoutForm(props: GenerativeUIComponentProps<typeof ui, "CheckoutForm">)`.
 * Data props are the parsed `props` schema, bound props included. Event and
 * slot props are present only when they are bound or filled.
 */
export type GenerativeUIComponentProps<
  UI extends AnyGenerativeUI,
  Name extends keyof GenerativeUIDefinitionsOf<UI>["components"] & string,
> = Simplify<
  DataProps<GenerativeUIDefinitionsOf<UI>["components"][Name]["props"]> &
    EventProps<
      GenerativeUIDefinitionsOf<UI>["components"][Name]["events"],
      GenerativeUIDefinitionsOf<UI>["functions"]
    > &
    SlotProps<GenerativeUIDefinitionsOf<UI>["components"][Name]["slots"]>
>;

// ---- Config types ----

type BaseDefinitions<Bases extends readonly AnyGenerativeUI[]> =
  GenerativeUIDefinitionsOf<Bases[number]>;

type MergedState<Bases extends readonly AnyGenerativeUI[], State> = Simplify<
  UnionToIntersection<BaseDefinitions<Bases>["state"]> & State
>;

type MergedFunctions<
  Bases extends readonly AnyGenerativeUI[],
  Functions,
> = Simplify<
  UnionToIntersection<BaseDefinitions<Bases>["functions"]> & Functions
>;

/** Props keys with the name of a top-level state key. */
type NameKeys<Props, State> = PropKeys<Props> & keyof State;

type SelectorFor<Props, State, Key extends PropKeys<Props>> = (
  state: StateValues<State>,
  // ponytail: the type hides the name-bound keys and the key itself. Other `bind` keys stay in it, because TypeScript cannot read the `bind` keys before it types the selectors.
  props: Simplify<Omit<OutputOf<Props>, NameKeys<Props, State> | Key>>,
) => InputOf<ShapeOf<Props>[Key]>;

type BindSelectors<Props, State> = {
  [Key in PropKeys<Props>]?: SelectorFor<Props, State, Key>;
};

/** Name-bound keys whose state type does not fit the prop schema input. */
type MismatchedNameKeys<Props, State> = {
  [Key in NameKeys<Props, State>]: [OutputOf<State[Key]>] extends [
    InputOf<ShapeOf<Props>[Key]>,
  ]
    ? never
    : Key;
}[NameKeys<Props, State>];

/**
 * `bind` is optional. When a prop has the name of a state key but the state
 * type does not fit, `bind` must give that prop a selector.
 */
type BindField<Props, State> = [MismatchedNameKeys<Props, State>] extends [
  never,
]
  ? { bind?: BindSelectors<Props, State> }
  : {
      bind: BindSelectors<Props, State> & {
        [Key in MismatchedNameKeys<Props, State>]-?: SelectorFor<
          Props,
          State,
          Key
        >;
      };
    };

/** `unknown` (no props) or a zod object. Else `props` gets an error. */
type PropsCheck<Props> = unknown extends Props
  ? unknown
  : Props extends PropsSchema
    ? unknown
    : { props?: PropsSchema };

type MatchCheck<Name extends string, Event, Functions> = [
  MatchedFunction<Name, Functions>,
] extends [never]
  ? "parameters" extends keyof Event
    ? unknown
    : { parameters: z.ZodTypeAny }
  : "parameters" extends keyof Event
    ? [OutputOf<Event["parameters" & keyof Event]>] extends [
        FunctionInput<Functions, MatchedFunction<Name, Functions>>,
      ]
      ? unknown
      : {
          parameters: `The output of these parameters does not fit the input of function "${MatchedFunction<
            Name,
            Functions
          > &
            string}".`;
        }
    : unknown;

/**
 * `unknown` when the event is valid. Else a type the event does not fit, so
 * `tsc` reports the error on the event.
 */
type EventCheck<
  Name extends string,
  Event,
  Functions,
> = Event extends GenerativeUIEventDefinition
  ? MatchCheck<Name, Event, Functions>
  : GenerativeUIEventDefinition;

type EventsCheck<Events, Functions> = {
  [Name in keyof Events]: EventCheck<Name & string, Events[Name], Functions>;
};

/**
 * Each component config is split over three mapped types. Each one infers
 * one part (props, events, slots) of every component. The checks are in
 * `NoInfer`, so they do not change what is inferred. They are not
 * intersected with zod types directly, because two zod class types do not
 * intersect cleanly.
 */
type ComponentsConfig<Props, Events, Slots, State, Functions> = {
  [Name in keyof Props]: {
    component: AnyComponent;
    description?: string;
    props?: Props[Name];
  } & NoInfer<PropsCheck<Props[Name]> & BindField<Props[Name], State>>;
} & {
  [Name in keyof Events]: {
    events?: Events[Name] & NoInfer<EventsCheck<Events[Name], Functions>>;
  };
} & {
  [Name in keyof Slots]: {
    slots?: Slots[Name] & Record<string, GenerativeUISlotKind>;
  };
};

/** The config of `createGenerativeUI`. */
export interface CreateGenerativeUIConfig<
  Bases extends readonly AnyGenerativeUI[],
  State extends Record<string, z.ZodTypeAny>,
  Functions extends Record<string, GenerativeUIFunctionDefinition>,
  Props extends Record<string, unknown>,
  Events extends Record<string, unknown>,
  Slots extends Record<string, unknown>,
> {
  /** Surfaces pin to it. Use a versioned id, for example "acme/store@1". */
  id: string;
  /** Bases. Their state, functions and components merge in, in order. */
  extends?: Bases;
  /** App state schemas, by top-level key. Put it before `components`. */
  state?: State;
  /** Functions that components can call. */
  functions?: Functions;
  /** The components the model can render. */
  components: ComponentsConfig<
    Props,
    Events,
    Slots,
    MergedState<Bases, State>,
    MergedFunctions<Bases, Functions>
  >;
}

type OwnComponents<Props, Events, Slots> = {
  [Name in keyof Props]: {
    props: Props[Name];
    events: Name extends keyof Events ? Events[Name] : unknown;
    slots: Name extends keyof Slots ? Slots[Name] : unknown;
  };
};

type ResultDefinitions<
  Bases extends readonly AnyGenerativeUI[],
  State,
  Functions,
  Props,
  Events,
  Slots,
> = {
  state: MergedState<Bases, State>;
  functions: MergedFunctions<Bases, Functions>;
  components: Simplify<
    UnionToIntersection<BaseDefinitions<Bases>["components"]> &
      OwnComponents<Props, Events, Slots>
  >;
};

// ---- Runtime ----

interface RuntimeComponentDefinition extends Omit<
  GenerativeUIComponentDefinition,
  "component"
> {
  component: AnyComponent;
}

interface RuntimeConfig {
  id: string;
  extends?: readonly AnyGenerativeUI[];
  state?: Record<string, z.ZodTypeAny>;
  functions?: Record<string, GenerativeUIFunctionDefinition>;
  components: Record<string, RuntimeComponentDefinition>;
}

const EMPTY_PROPS = z.object({}).strict();

const RESERVED_KEYS = new Set(["id", "component"]);

/**
 * Experimental. Declares the components the model can render, the app state
 * they read, and the functions they call.
 *
 * - A prop with the name of a top-level state key is bound to that state.
 * - `bind: { prop: (state, props) => value }` binds a prop to a selector.
 * - An event binds to the function with its name, else to the name without
 *   `on` (`onAddToCart` calls `addToCart`).
 *
 * The model does not see bound props or matched events.
 *
 * @param config - `id`, then optional `extends`, `state` and `functions`,
 *   then `components`. Put `state` before `components`, so the selectors
 *   get typed state.
 * @throws Error when a name comes from two places, a key is reserved or used
 *   twice on a component, an event matches two functions, an unmatched event
 *   has no `parameters`, or a `bind` key is not a prop.
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
  State extends Record<string, z.ZodTypeAny> = {},
  Functions extends Record<string, GenerativeUIFunctionDefinition> = {},
  Props extends Record<string, unknown> = {},
  Events extends Record<string, unknown> = {},
  Slots extends Record<string, unknown> = {},
>(
  config: CreateGenerativeUIConfig<
    Bases,
    State,
    Functions,
    Props,
    Events,
    Slots
  >,
) {
  // TypeScript cannot relate the generic mapped config type to the runtime
  // shape. The config type is stricter than `RuntimeConfig`, so this is safe.
  const ui: GenerativeUI<
    ResultDefinitions<Bases, State, Functions, Props, Events, Slots>
  > = buildGenerativeUI(config as RuntimeConfig);
  return ui;
}

function buildGenerativeUI(config: RuntimeConfig) {
  const where = `generative UI "${config.id}"`;
  const state = new Map<string, z.ZodTypeAny>();
  const functions = new Map<string, GenerativeUIFunctionDefinition>();
  const definitions = new Map<string, RuntimeComponentDefinition>();

  function add<Value>(
    map: Map<string, Value>,
    kind: string,
    name: string,
    value: Value,
  ) {
    if (map.has(name)) {
      throw new Error(
        `[generativeUI] ${kind} "${name}" is defined more than once in ${where}.`,
      );
    }
    map.set(name, value);
  }

  const bases = config.extends ?? [];
  for (const base of bases) {
    for (const [name, schema] of base.state)
      add(state, "State key", name, schema);
    for (const [name, fn] of base.functions)
      add(functions, "Function", name, fn);
    for (const [name, component] of base.components)
      add(definitions, "Component", name, component);
  }
  for (const [name, schema] of Object.entries(config.state ?? {}))
    add(state, "State key", name, schema);
  for (const [name, fn] of Object.entries(config.functions ?? {}))
    add(functions, "Function", name, fn);
  for (const [name, component] of Object.entries(config.components))
    add(definitions, "Component", name, component);

  const components = new Map<string, ResolvedGenerativeUIComponent>();
  const manifestComponents: Record<string, GenerativeUIComponentManifest> = {};
  for (const [name, definition] of definitions) {
    const { component, manifest } = resolveComponent(name, definition, {
      state,
      functions,
      where,
    });
    components.set(name, component);
    manifestComponents[name] = manifest;
  }
  return {
    id: config.id,
    state,
    functions,
    components,
    manifestComponents,
  };
}

interface ResolveContext {
  state: ReadonlyMap<string, z.ZodTypeAny>;
  functions: ReadonlyMap<string, GenerativeUIFunctionDefinition>;
  where: string;
}

/** Builds the selectors, the event map and the manifest of one component. */
function resolveComponent(
  name: string,
  definition: RuntimeComponentDefinition,
  context: ResolveContext,
) {
  assertDisjointKeys(name, definition);
  const props: PropsSchema = definition.props ?? EMPTY_PROPS;

  const selectors: Record<string, GenerativeUISelector> = {};
  const propKeys = Object.keys(props.shape);
  for (const key of propKeys) {
    if (context.state.has(key)) selectors[key] = (state) => state[key];
  }
  const bind = definition.bind ?? {};
  for (const [key, selector] of Object.entries(bind)) {
    if (!(key in props.shape)) {
      throw new Error(
        `[generativeUI] bind key "${key}" is not a prop of component "${name}" in ${context.where}.`,
      );
    }
    selectors[key] = selector;
  }
  const boundMask: Record<string, true> = {};
  for (const key of Object.keys(selectors)) boundMask[key] = true;

  const eventFunctions: Record<string, string> = {};
  const modelEvents: NonNullable<GenerativeUIComponentManifest["events"]> = {};
  const events = definition.events ?? {};
  for (const [eventName, event] of Object.entries(events)) {
    const functionName = matchFunction(eventName, name, context);
    if (functionName !== undefined) {
      eventFunctions[eventName] = functionName;
      continue;
    }
    if (!event.parameters) {
      throw new Error(
        `[generativeUI] Event "${eventName}" of component "${name}" matches no function in ${context.where}, so it needs "parameters".`,
      );
    }
    modelEvents[eventName] = {
      ...(event.description ? { description: event.description } : {}),
      parameters: toJsonSchema(event.parameters),
    };
  }

  const modelProps = props.omit(boundMask);
  const component: ResolvedGenerativeUIComponent = {
    // The config checks components against `AnyComponent` (see above). Here
    // the renderer needs the React type.
    component: definition.component as ComponentType<any>,
    description: definition.description,
    props: definition.props,
    bind: definition.bind,
    events: definition.events,
    slots: definition.slots,
    selectors,
    eventFunctions,
    modelProps,
    boundProps: props.pick(boundMask),
  };
  return {
    component,
    manifest: toManifest(definition, modelProps, modelEvents),
  };
}

/** `onAddToCart` to `addToCart`. `undefined` when the name has no `on` prefix. */
function withoutOnPrefix(eventName: string) {
  const hasOnPrefix = eventName.length > 2 && eventName.startsWith("on");
  if (!hasOnPrefix) return undefined;
  return eventName.charAt(2).toLowerCase() + eventName.slice(3);
}

/** The declared function an event calls, or `undefined` when none matches. */
function matchFunction(
  eventName: string,
  componentName: string,
  context: ResolveContext,
) {
  const exact = context.functions.has(eventName) ? eventName : undefined;
  const stripped = withoutOnPrefix(eventName);
  const fromPrefix =
    stripped !== undefined && context.functions.has(stripped)
      ? stripped
      : undefined;
  if (exact !== undefined && fromPrefix !== undefined) {
    throw new Error(
      `[generativeUI] Event "${eventName}" of component "${componentName}" matches two functions, "${exact}" and "${fromPrefix}", in ${context.where}.`,
    );
  }
  return exact ?? fromPrefix;
}

function assertDisjointKeys(
  name: string,
  definition: RuntimeComponentDefinition,
) {
  const seen = new Set<string>();
  const keys = [
    ...Object.keys(definition.props?.shape ?? {}),
    ...Object.keys(definition.events ?? {}),
    ...Object.keys(definition.slots ?? {}),
  ];
  for (const key of keys) {
    if (RESERVED_KEYS.has(key)) {
      throw new Error(
        `[generativeUI] "${key}" is reserved by A2UI and cannot be a prop, event or slot of component "${name}".`,
      );
    }
    if (seen.has(key)) {
      throw new Error(
        `[generativeUI] "${key}" is declared as more than one of prop, event, slot on component "${name}".`,
      );
    }
    seen.add(key);
  }
}

function toManifest(
  definition: RuntimeComponentDefinition,
  modelProps: PropsSchema,
  modelEvents: NonNullable<GenerativeUIComponentManifest["events"]>,
) {
  const manifest: GenerativeUIComponentManifest = {
    props: toJsonSchema(modelProps.strict()),
  };
  if (definition.description) manifest.description = definition.description;
  if (Object.keys(modelEvents).length > 0) manifest.events = modelEvents;
  if (definition.slots) manifest.slots = { ...definition.slots };
  return manifest;
}
