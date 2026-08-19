import { createChannelCallbackBinding } from "@copilotkit/channels-ui";
import type {
  ChannelCallbackBinding,
  IncomingMessage,
  InteractionContext,
  Renderable,
  Thread,
} from "@copilotkit/channels-ui";
import type { InferSchemaOutput, ObjectSchema } from "./standard-schema.js";
import type { InferStream } from "@copilotkit/schema";
import type { GenericSchema } from "@copilotkit/schema";
import type { ChannelComponentErrorSnapshot } from "./component-store.js";
import type { JsonValue } from "./json-value.js";

export type ChannelComponentPlatform =
  | "slack"
  | "teams"
  | "discord"
  | "telegram"
  | "whatsapp";

/** Internal adapter context retained for legacy JSX component recovery. */
export interface ChannelComponentAdapterRenderContext {
  platform: ChannelComponentPlatform;
  signal: AbortSignal;
}

/** Readiness of one streamed JSON node. */
export type ChannelComponentNodeStatus =
  | "missing"
  | "partial"
  | "complete"
  | "invalid";

/** Typed path segments supported by component readiness lookups. */
export type ChannelComponentPath<T> = T extends readonly (infer Item)[]
  ? readonly [] | readonly [number, ...ChannelComponentPath<Item>]
  : T extends object
    ?
        | readonly []
        | {
            [Key in keyof T & string]: readonly [
              Key,
              ...ChannelComponentPath<T[Key]>,
            ];
          }[keyof T & string]
    : readonly [];

/** Functional readiness lookup supplied by the streaming schema resolver. */
export type ChannelComponentStatus<T> = (
  ...path: ChannelComponentPath<T>
) => ChannelComponentNodeStatus;

/** Functional callback state update applied against current stored state. */
export type ChannelComponentSetState<State> = (
  next: State | ((current: State) => State),
) => Promise<void>;

/** Stream inference for CopilotKit schemas; other Standard Schemas are final-only. */
export type InferChannelComponentStream<Schema> =
  Schema extends GenericSchema<unknown, unknown> ? InferStream<Schema> : never;

interface ChannelComponentCallbackSharedContext<State> {
  state: State;
  revision: number;
  thread: Thread;
  message: IncomingMessage;
  interaction: InteractionContext;
}

/** Exact render snapshot captured by a provider interaction. */
export type ChannelComponentCallbackBaseContext<Props, StreamProps, State> = [
  StreamProps,
] extends [never]
  ? ChannelComponentCallbackSharedContext<State> & {
      phase: "ready";
      props: Props;
    }
  :
      | (ChannelComponentCallbackSharedContext<State> & {
          phase: "streaming";
          props: StreamProps;
        })
      | (ChannelComponentCallbackSharedContext<State> & {
          phase: "ready";
          props: Props;
        });

/** Callback context for a component with local state. */
export type StatefulChannelComponentCallbackContext<Props, StreamProps, State> =
  ChannelComponentCallbackBaseContext<Props, StreamProps, State> & {
    setState: ChannelComponentSetState<State>;
  };

/** Callback context for a component without local state. */
export type StatelessChannelComponentCallbackContext<Props, StreamProps> =
  ChannelComponentCallbackBaseContext<Props, StreamProps, undefined>;

/** Named callback accepted by the component definition. */
export type ChannelComponentCallback<Args, Context> = (
  args: Args,
  context: Context,
) => void | Promise<void>;

/** Any named callback record before contextual inference is applied. */
export type ChannelComponentCallbackRecord = Record<
  string,
  (...args: never[]) => unknown
>;

/** Render-time binders inferred from callback first arguments. */
export type ChannelComponentCallbackBinders<CallbackArgs> = {
  readonly [Name in keyof CallbackArgs]: (
    args: CallbackArgs[Name],
  ) => ChannelCallbackBinding<CallbackArgs[Name]>;
};

interface ChannelComponentRenderBase<State> {
  platform: ChannelComponentPlatform;
  state: State;
  revision: number;
}

export interface ChannelComponentStreamingRenderContext<
  StreamProps,
  State,
  CallbackArgs,
> extends ChannelComponentRenderBase<State> {
  phase: "streaming";
  props: StreamProps;
  status: ChannelComponentStatus<StreamProps>;
  callbacks: ChannelComponentCallbackBinders<CallbackArgs>;
}

export interface ChannelComponentReadyRenderContext<
  Props,
  State,
  CallbackArgs,
> extends ChannelComponentRenderBase<State> {
  phase: "ready";
  props: Props;
  callbacks: ChannelComponentCallbackBinders<CallbackArgs>;
}

export interface ChannelComponentFailedRenderContext<
  StreamProps,
  State,
> extends ChannelComponentRenderBase<State> {
  phase: "failed";
  props?: StreamProps;
  error: ChannelComponentErrorSnapshot;
  callbacks?: never;
}

/** Phase-discriminated synchronous render input for a Channel component. */
export type ChannelComponentRenderContext<
  Props = Record<string, unknown>,
  StreamProps = Partial<Props>,
  State = undefined,
  CallbackArgs = Record<string, never>,
> =
  | ([StreamProps] extends [never]
      ? ChannelComponentReadyRenderContext<Props, State, CallbackArgs>
      :
          | ChannelComponentStreamingRenderContext<
              StreamProps,
              State,
              CallbackArgs
            >
          | ChannelComponentReadyRenderContext<Props, State, CallbackArgs>)
  | ChannelComponentFailedRenderContext<StreamProps, State>;

type StatefulCallbacks<Props, StreamProps, State, CallbackArgs> = {
  [Name in keyof CallbackArgs]: ChannelComponentCallback<
    CallbackArgs[Name],
    StatefulChannelComponentCallbackContext<Props, StreamProps, State>
  >;
};

type StatelessCallbacks<Props, StreamProps, CallbackArgs> = {
  [Name in keyof CallbackArgs]: ChannelComponentCallback<
    CallbackArgs[Name],
    StatelessChannelComponentCallbackContext<Props, StreamProps>
  >;
};

export interface StatefulChannelComponentDefinition<
  Schema extends ObjectSchema,
  State extends JsonValue,
  CallbackArgs extends Record<string, JsonValue>,
  StreamProps = InferChannelComponentStream<Schema>,
> {
  name: string;
  description: string;
  parameters: Schema;
  getInitialState(): State;
  callbacks: StatefulCallbacks<
    InferSchemaOutput<Schema>,
    StreamProps,
    State,
    CallbackArgs
  >;
  render(
    context: ChannelComponentRenderContext<
      InferSchemaOutput<Schema>,
      StreamProps,
      State,
      CallbackArgs
    >,
  ): Renderable;
}

export interface StatelessChannelComponentDefinition<
  Schema extends ObjectSchema,
  CallbackArgs extends Record<string, JsonValue> = Record<string, never>,
  StreamProps = InferChannelComponentStream<Schema>,
> {
  name: string;
  description: string;
  parameters: Schema;
  getInitialState?: never;
  callbacks?: StatelessCallbacks<
    InferSchemaOutput<Schema>,
    StreamProps,
    CallbackArgs
  >;
  render(
    context: ChannelComponentRenderContext<
      InferSchemaOutput<Schema>,
      StreamProps,
      undefined,
      CallbackArgs
    >,
  ): Renderable;
}

/** Public component definition accepted by createChannel registration. */
export interface ChannelComponentDefinition<
  Schema extends ObjectSchema = ObjectSchema,
> {
  name: string;
  description: string;
  parameters: Schema;
  getInitialState?: () => unknown;
  callbacks?: ChannelComponentCallbackRecord;
  render(context: never): Renderable;
}

/** Define a stateless agent-rendered Channel component with inferred contracts. */
export function defineChannelComponent<
  Schema extends ObjectSchema,
  CallbackArgs extends Record<string, JsonValue> = Record<string, never>,
>(
  component: StatelessChannelComponentDefinition<Schema, CallbackArgs>,
): StatelessChannelComponentDefinition<Schema, CallbackArgs>;

/** Define a stateful agent-rendered Channel component with inferred contracts. */
export function defineChannelComponent<
  Schema extends ObjectSchema,
  State extends JsonValue,
  CallbackArgs extends Record<string, JsonValue>,
>(
  component: StatefulChannelComponentDefinition<Schema, State, CallbackArgs>,
): StatefulChannelComponentDefinition<Schema, State, CallbackArgs>;

export function defineChannelComponent(component: unknown): unknown {
  return component;
}

/** Create render-time callback binders for a named callback record. */
export function createChannelComponentCallbackBinders<
  Callbacks extends Record<string, (...args: never[]) => unknown>,
>(
  callbacks: Callbacks,
): ChannelComponentCallbackBinders<{
  [Name in keyof Callbacks]: Parameters<Callbacks[Name]>[0];
}> {
  return Object.fromEntries(
    Object.keys(callbacks).map((name) => [
      name,
      (args: unknown) => createChannelCallbackBinding(name, args),
    ]),
  ) as ChannelComponentCallbackBinders<{
    [Name in keyof Callbacks]: Parameters<Callbacks[Name]>[0];
  }>;
}

/** Distinguish component-tool descriptors from legacy JSX component functions. */
export function isChannelComponentDefinition(
  value: unknown,
): value is ChannelComponentDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { description?: unknown }).description === "string" &&
    typeof (value as { render?: unknown }).render === "function" &&
    typeof (value as { parameters?: { "~standard"?: unknown } }).parameters?.[
      "~standard"
    ] === "object"
  );
}
