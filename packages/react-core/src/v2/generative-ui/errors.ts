import type { z } from "zod";
import type { GenerativeUICatalog } from "./catalog";

export type GenerativeUIErrorCode =
  | "function_not_found"
  | "function_not_exposed"
  | "function_conflict"
  | "invalid_arguments"
  | "handler_failed"
  | "invalid_event_args"
  | "event_forward_failed";

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

type Definitions<Catalog extends GenerativeUICatalog<any>> = NonNullable<
  Catalog["definitions"]
>;

type ComponentEvents<Definition> = Definition extends { events?: infer Events }
  ? NonNullable<Events>
  : never;

type IsUnion<T, U = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : never;

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

/** One member of a union. Used only after IsUnion proved the members equal. */
type OneOf<U> =
  UnionToIntersection<U extends unknown ? () => U : never> extends () => infer R
    ? R
    : never;

/** Every event name that a component of the catalog declares. */
export type GenerativeUIEventName<Catalog extends GenerativeUICatalog<any>> = {
  [Component in keyof Definitions<Catalog>]: keyof ComponentEvents<
    Definitions<Catalog>[Component]
  > &
    string;
}[keyof Definitions<Catalog>];

type EventArgs<
  Catalog extends GenerativeUICatalog<any>,
  Name extends string,
> = {
  [Component in keyof Definitions<Catalog>]: ComponentEvents<
    Definitions<Catalog>[Component]
  > extends infer Events
    ? Name extends keyof Events
      ? Events[Name] extends {
          parameters: infer Parameters extends z.ZodTypeAny;
        }
        ? z.input<Parameters>
        : never
      : never
    : never;
}[keyof Definitions<Catalog>];

/**
 * Type of an event prop as seen by a catalog component, looked up by event
 * name in the catalog that renders the component:
 * `onSubmit?: GenerativeUIEventHandler<typeof catalog, "onSubmit">`.
 *
 * When components of the catalog declare the event with different
 * parameters, the result is not callable and names the conflict.
 */
export type GenerativeUIEventHandler<
  Catalog extends GenerativeUICatalog<any>,
  Name extends GenerativeUIEventName<Catalog>,
> =
  true extends IsUnion<EventArgs<Catalog, Name>>
    ? {
        readonly error: `"${Name}" has different parameters on different components of this catalog`;
      }
    : (
        args: OneOf<EventArgs<Catalog, Name>>,
      ) => Promise<GenerativeUIInvokeResult>;

export interface GenerativeUIErrorInfo {
  kind: "render" | "props" | "operation" | "function" | "event";
  surfaceId: string;
  componentId?: string;
  error: Error;
}
