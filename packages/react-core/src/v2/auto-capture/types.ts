import type { RecordUserActionInput } from "../hooks/use-record-user-action";

/**
 * HTTP methods auto-capture can observe. Mutating verbs are captured by
 * default; the full set is allowed so a developer can opt into `GET` etc.
 */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/**
 * A redacted, parsed view of one intercepted HTTP exchange. This is the shape
 * handed to a developer-supplied {@link AutoCaptureUserActionsConfig.transform}
 * — every field has already passed through redaction, so secrets never reach
 * custom code.
 */
export interface CapturedRequest {
  /** Uppercased HTTP method. */
  method: HttpMethod;
  /** Absolute request URL, with sensitive query params already redacted. */
  url: string;
  /**
   * Parsed, redacted request body — an object for JSON / form payloads, a
   * string for anything else, or `undefined` when there was no body (or it
   * could not be read, e.g. a binary upload).
   */
  requestBody: unknown;
  /** HTTP response status code. */
  status: number;
  /**
   * Parsed, redacted response body. `undefined` when
   * {@link AutoCaptureUserActionsConfig.captureResponseBody} is `false` or the
   * body was empty / unreadable.
   */
  responseBody?: unknown;
  /** Wall-clock duration of the request in milliseconds. */
  durationMs: number;
}

/**
 * The action shape produced by the default mapping (or a custom `transform`)
 * for one captured request. It is exactly {@link RecordUserActionInput} minus
 * `threadId`, which auto-capture resolves and attaches itself (see
 * {@link AutoCaptureUserActionsConfig.threadId}).
 */
export type AutoCapturedUserAction = Omit<RecordUserActionInput, "threadId">;

/** Sensitive-field redaction options. A built-in deny list always applies. */
export interface RedactionConfig {
  /**
   * Extra sensitive key names, merged (case-insensitively) into the built-in
   * deny list. Matching keys are masked or removed in request bodies, response
   * bodies, and query strings.
   */
  keys?: string[];
  /**
   * Replacement for a matched value. A string masks the value (default
   * `"***"`); `null` removes the key entirely.
   */
  replaceWith?: string | null;
}

/**
 * Configuration for automatic user-action capture. Supplied to
 * `useAutoCaptureUserActions(config)` or the `autoCaptureUserActions` prop on
 * `<CopilotKitProvider>`. The feature is **off** unless a config is supplied
 * with `enabled !== false`.
 */
export interface AutoCaptureUserActionsConfig {
  /** Master switch. Defaults to `true` once a config is supplied. */
  enabled?: boolean;
  /** HTTP methods to capture. Default: `["POST", "PUT", "PATCH", "DELETE"]`. */
  methods?: HttpMethod[];
  /**
   * URL patterns to capture. A string matches by substring; a `RegExp` by
   * `.test()`. When omitted, only **same-origin** requests are captured.
   */
  allowUrls?: Array<string | RegExp>;
  /**
   * URL patterns to never capture. The platform's own
   * `${runtimeUrl}/user-actions` endpoint is always excluded regardless of this
   * list (this is the loop guard and cannot be overridden).
   */
  denyUrls?: Array<string | RegExp>;
  /** Capture and record the response body. Default: `true`. */
  captureResponseBody?: boolean;
  /** Sensitive-field redaction. A built-in deny list always applies. */
  redact?: RedactionConfig;
  /**
   * Thread the captured actions are recorded under. A string or a resolver
   * function overrides the current chat thread. When omitted, the current chat
   * thread (from the surrounding `CopilotChatConfigurationProvider`) is used;
   * if neither is available the capture is skipped with a one-time warning.
   */
  threadId?: string | (() => string);
  /**
   * Redact-first override. Receives an already-redacted {@link CapturedRequest}
   * and returns the action to record, or `null` to skip this request. When
   * omitted, a default mapping is used.
   */
  transform?: (request: CapturedRequest) => AutoCapturedUserAction | null;
}

/**
 * A raw, parsed HTTP exchange handed from the patch layer (fetch / XHR) to the
 * capture pipeline. Bodies are parsed but **not yet redacted** — the pipeline
 * owns redaction so it happens in exactly one place.
 */
export interface RawExchange {
  method: string;
  url: string;
  requestBody: unknown;
  status: number;
  responseBody: unknown;
  durationMs: number;
}
