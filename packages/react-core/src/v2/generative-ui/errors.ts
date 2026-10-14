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

/** Type of an event prop as seen by a catalog component. */
export type GenerativeUIEventHandler<A = Record<string, unknown>> = (
  args: A,
) => Promise<GenerativeUIInvokeResult>;

export interface GenerativeUIErrorInfo {
  kind: "render" | "props" | "operation" | "function" | "event";
  surfaceId: string;
  componentId?: string;
  error: Error;
}
