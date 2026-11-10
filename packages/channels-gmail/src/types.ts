import type { StateStore } from "@copilotkit/channels-core";

/** Gmail OAuth2 refresh-token credentials. The adapter refreshes the access token itself. */
export interface GmailOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Limits for inbound attachments turned into agent content parts. */
export interface GmailFileOptions {
  /** Skip one attachment larger than this many bytes. Default 8 MiB. */
  maxBytesPerFile?: number;
  /** Read at most this many attachments per email. Default 5. */
  maxFiles?: number;
  /** Cut a text attachment to this many bytes. Default 200 KiB. */
  maxTextBytes?: number;
}

/** Signed action links for buttons and select options in reply emails. */
export interface GmailActionLinkOptions {
  /**
   * Public URL of the adapter handler, for example
   * `https://bot.example.com/gmail`. Links point here.
   */
  baseUrl: string;
  /** Secret for the HMAC signature on each link. Use at least 32 random bytes. */
  secret: string;
  /** How long a link stays valid, in milliseconds. Default 7 days. */
  ttlMs?: number;
}

export interface GmailAdapterOptions {
  /** OAuth2 refresh-token credentials. Give this or {@link getAccessToken}. */
  oauth?: GmailOAuthCredentials;
  /**
   * Return a valid Gmail access token. Use it when your app already manages
   * Google tokens. The adapter calls it before each request and does not cache
   * the result.
   */
  getAccessToken?: () => string | Promise<string>;
  /**
   * Pub/Sub topic that receives Gmail notifications, in the form
   * `projects/<project>/topics/<topic>`. `start()` calls `users.watch` with it.
   * Required unless `watch` is `false`.
   */
  topicName?: string;
  /**
   * Call `users.watch` in `start()` and renew it every day. Default `true`.
   * Set `false` when another process owns the watch.
   */
  watch?: boolean;
  /**
   * Only mail with this Gmail label id is answered. Default `"INBOX"`. Use a
   * label id (for example `Label_123`), not a label name.
   */
  labelId?: string;
  /**
   * The bot's own address. Mail from it is never answered. Defaults to the
   * address of the authenticated mailbox (`users.getProfile`).
   */
  address?: string;
  /** Display name on the `From` header of replies. */
  fromName?: string;
  /**
   * Verify Pub/Sub push requests with the OIDC token Pub/Sub signs. Set this on
   * the push subscription ("Enable authentication") and give the same
   * audience here. This is the stronger option.
   */
  pubsubAuth?: {
    /** The audience set on the push subscription. Often the push endpoint URL. */
    audience: string;
    /** The service account the subscription signs with. Checked when set. */
    serviceAccountEmail?: string;
  };
  /**
   * Verify Pub/Sub push requests with a shared token in the push endpoint
   * query string (`?token=...`). Simpler, but the token sits in the URL, so
   * it can appear in logs. Give `pubsubAuth` or this, or both.
   */
  verificationToken?: string;
  /**
   * Render handler buttons and select options as signed links. Without this,
   * those controls are dropped from the email and only their labels stay.
   * Link buttons (`<Button url>`) always render as links.
   */
  actions?: GmailActionLinkOptions;
  /**
   * Where the adapter keeps its Gmail sync cursor, processed message ids and
   * used action links. Default: in memory, which is lost on restart. Pass the
   * same durable store you give `createChannel` so a restart resumes where it
   * stopped and a link can be used only once across processes.
   */
  store?: StateStore;
  /** Limits for inbound attachments. */
  files?: GmailFileOptions;
  /** Largest outbound attachment, in bytes. Default and maximum 25 MB. */
  maxAttachmentBytes?: number;
  /**
   * Start a `node:http` server on this port in `channel.start()`. It serves
   * {@link GmailAdapter.handler}. Omit it when you mount `handler` in your own
   * server or serverless route.
   */
  port?: number;
  /** Host for the `port` server. */
  host?: string;
  /** Path for the `port` server. Default `"/gmail"`. Other paths get `404`. */
  path?: string;
  /** Custom event names treated as agent interrupts. Default `on_interrupt`. */
  interruptEventNames?: ReadonlySet<string>;
  /**
   * Keep background work alive after the handler returns. The handler answers
   * Pub/Sub and link clicks first, then runs your Channel handlers in the
   * background. On serverless hosts, pass the platform's `waitUntil` (for
   * example from `@vercel/functions`) so that work is not cut off.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** `fetch` used for all Google requests. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/**
 * Opaque reply target for one Gmail thread. Handlers never build it: the
 * adapter creates it per inbound email or action link.
 */
export interface GmailReplyTarget {
  /** Gmail thread id. Also the Channel `conversationKey`. */
  threadId: string;
  /** Gmail id of the email this reply answers, when there is one. */
  inboundId?: string;
  /** Who gets the reply. */
  to: string;
  /** Subject of the email being answered. */
  subject: string;
  /** RFC 5322 `Message-ID` of the email being answered. */
  rfcMessageId?: string;
  /** RFC 5322 `References` of the email being answered. */
  references: string[];
}

/** Message reference returned by `post`, `stream`, and `postFile`. */
export interface GmailMessageRef {
  /** Gmail message id of the sent email. */
  id: string;
  threadId: string;
  [k: string]: unknown;
}
