import type { Message } from "@ag-ui/core";

/** The person behind one web request. */
export interface WebUser {
  /** Stable id for this person in your app. */
  id: string;
  /** Display name, when you know it. */
  name?: string;
  /** Email, when you know it. */
  email?: string;
}

export interface WebAdapterOptions {
  /**
   * Resolve the person behind a request, for example from a session cookie or
   * a bearer token. Return `null` or `undefined` for an anonymous visitor.
   * Throw to reject the request: the handler then answers `401`.
   *
   * Without this option every visitor is anonymous. An anonymous visitor gets
   * one actor id per conversation (`anonymous:<threadId>`), with kind
   * `"unknown"`, so `identifyUser: "platform"` gives them no application user.
   */
  getUser?: (
    request: Request,
  ) => WebUser | null | undefined | Promise<WebUser | null | undefined>;
  /**
   * Start a `node:http` server on this port in `channel.start()`. It serves
   * the same handler as {@link WebAdapter.handler}. Omit it when you mount
   * `handler` in your own server or serverless route.
   */
  port?: number;
  /** Host for the `port` server. Defaults to Node's default (all interfaces). */
  host?: string;
  /** Path for the `port` server. Defaults to `"/"`. Other paths get `404`. */
  path?: string;
  /**
   * Browser origins that may call the handler from another origin. Use `"*"`
   * for any origin. The handler then answers CORS preflight requests and adds
   * `Access-Control-Allow-Origin` to responses. Empty by default (same origin
   * only).
   */
  allowedOrigins?: readonly string[];
  /** Custom event names treated as agent interrupts. Defaults to `on_interrupt`. */
  interruptEventNames?: ReadonlySet<string>;
}

/**
 * Opaque reply target for one web request. Handlers never build it: the
 * adapter creates it per request.
 */
export interface WebReplyTarget {
  /** AG-UI `threadId`. Also the Channel `conversationKey`. */
  threadId: string;
  /** AG-UI `runId` of the request that produced this target. */
  runId: string;
  /** The conversation history the client sent with the request. */
  messages: Message[];
}

/** Message reference returned by `post`/`stream` and accepted by `update`/`delete`. */
export interface WebMessageRef {
  /** The AG-UI message id. Also the key of the UI in `channels.ui` events. */
  id: string;
  threadId: string;
  [k: string]: unknown;
}
