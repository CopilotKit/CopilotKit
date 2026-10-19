import type {
  GenerativeUI,
  GenerativeUIDefinitionsOf,
  GenerativeUIEventInput,
  UnionToIntersection,
} from "./catalog";

export type GenerativeUIErrorCode =
  | "function_not_found"
  | "function_conflict"
  | "invalid_arguments"
  | "handler_failed"
  | "invalid_event_args"
  | "event_forward_failed"
  /** A function value or check could not be computed. */
  | "expression_error"
  /** A function the caller may not call: `openUrl` from the agent. */
  | "invalid_function_call";

export class GenerativeUIError extends Error {
  readonly code: GenerativeUIErrorCode;
  constructor(code: GenerativeUIErrorCode, message: string) {
    super(message);
    this.name = "GenerativeUIError";
    this.code = code;
  }
}

export type GenerativeUIInvokeResult =
  | { ok: true; result: unknown }
  | { ok: false; error: GenerativeUIError };

type Components<UI extends GenerativeUI<any>> =
  GenerativeUIDefinitionsOf<UI>["components"];

type EventsOf<
  UI extends GenerativeUI<any>,
  Component extends keyof Components<UI>,
> =
  Components<UI>[Component]["events"] extends Record<string, unknown>
    ? Components<UI>[Component]["events"]
    : {};

type IsUnion<T, U = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : never;

/** One member of a union. Used only after IsUnion proved the members equal. */
type OneOf<U> =
  UnionToIntersection<U extends unknown ? () => U : never> extends () => infer R
    ? R
    : never;

/** Every event name that a component of the UI declares, bases included. */
export type GenerativeUIEventName<UI extends GenerativeUI<any>> = {
  [Component in keyof Components<UI>]: keyof EventsOf<UI, Component> & string;
}[keyof Components<UI>];

type EventArgs<UI extends GenerativeUI<any>, Name extends string> = {
  [Component in keyof Components<UI>]: Name extends keyof EventsOf<
    UI,
    Component
  >
    ? GenerativeUIEventInput<
        Name,
        EventsOf<UI, Component>[Name],
        GenerativeUIDefinitionsOf<UI>["functions"]
      >
    : never;
}[keyof Components<UI>];

/**
 * Type of an event prop as seen by a component, looked up by event name in
 * the generative UI that renders the component:
 * `onSubmit?: GenerativeUIEventHandler<typeof ui, "onSubmit">`.
 *
 * The argument is the event `parameters` input. A matched event without
 * `parameters` takes the input of its function.
 *
 * When components of the UI declare the event with different arguments, the
 * result is not callable and names the conflict.
 */
export type GenerativeUIEventHandler<
  UI extends GenerativeUI<any>,
  Name extends GenerativeUIEventName<UI>,
> =
  true extends IsUnion<EventArgs<UI, Name>>
    ? {
        readonly error: `"${Name}" has different parameters on different components of this generative UI`;
      }
    : (args: OneOf<EventArgs<UI, Name>>) => Promise<GenerativeUIInvokeResult>;

export interface GenerativeUIErrorInfo {
  kind: "render" | "props" | "operation" | "function" | "event";
  surfaceId: string;
  componentId?: string;
  error: Error;
}
