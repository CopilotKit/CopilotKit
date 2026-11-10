import type { StateStore } from "@copilotkit/channels-core";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import type { ResendFileOptions } from "./attachments.js";
import type { Mailbox } from "./threading.js";

/** Signed action links: how handler buttons work in email. */
export interface ResendActionLinkOptions {
  /**
   * Public URL of the route where you mount `adapter.handler` (the same
   * route as the webhook). Links point here with a `ck_action` query
   * parameter.
   */
  baseUrl: string;
  /** Secret that signs the links (HMAC-SHA256). Use a long random string. */
  secret: string;
  /** How long a link works, in milliseconds. Default 7 days. */
  ttlMs?: number;
  /**
   * Show a confirmation page with a button first (default `true`). Mail
   * security scanners open links in emails; with confirmation, opening a
   * link does nothing until a person presses the button. Set `false` to run
   * the action as soon as the link is opened.
   */
  confirm?: boolean;
}

export interface ResendAdapterOptions {
  /** Resend API key (`re_...`). Needs permission to send and to read received emails. */
  apiKey: string;
  /** The bot's sender, e.g. `"Support <support@example.com>"`. The domain must be verified in Resend. */
  from: string;
  /** Webhook signing secret from the Resend dashboard (`whsec_...`). */
  webhookSecret: string;
  /** `Reply-To` for outbound email. Defaults to none (replies go to `from`). */
  replyTo?: string | readonly string[];
  /**
   * Only handle email sent to one of these addresses (matched against To,
   * Cc, and the delivered-for addresses, case-insensitive). Default: handle
   * every received email.
   */
  allowedRecipients?: readonly string[];
  /**
   * Turn handler buttons and select options into signed links. Without
   * this, those controls are dropped and only their labels stay. Link
   * buttons (`<Button url>`) always render.
   */
  actions?: ResendActionLinkOptions;
  /**
   * Where the adapter keeps thread mappings, reply state, history, and
   * used link ids. Defaults to an in-memory store, which is lost on restart
   * and not shared between instances. Pass the same store you give
   * `createChannel` (Redis, Postgres) to keep threads across restarts.
   */
  store?: StateStore;
  /** Limits for inbound attachments. */
  files?: ResendFileOptions;
  /**
   * Handle only email whose DMARC check passed. Default `false`: email
   * that failed DMARC is always skipped, and email without a DMARC result
   * is handled.
   */
  requireDmarcPass?: boolean;
  /**
   * Called with the work started by a webhook or a link click, after the
   * response is ready. Pass your platform's `waitUntil` on serverless hosts
   * (Vercel, Cloudflare) so the work can finish after the response.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Start a `node:http` server on this port in `channel.start()`. It serves
   * {@link ResendAdapter.handler}. Omit it when you mount `handler` in your
   * own server or serverless route.
   */
  port?: number;
  /** Host for the `port` server. Defaults to Node's default (all interfaces). */
  host?: string;
  /** Path for the `port` server. Defaults to `"/"`. Other paths get `404`. */
  path?: string;
  /** Custom event names treated as agent interrupts. Defaults to `on_interrupt`. */
  interruptEventNames?: ReadonlySet<string>;
  /** Resend API origin. Defaults to `https://api.resend.com`. */
  apiUrl?: string;
  /** `fetch` used for Resend API calls and attachment downloads. Defaults to the global one. */
  fetch?: typeof fetch;
}

/**
 * Opaque reply target for one email thread. Handlers never build it: the
 * adapter creates it for each received email and link click.
 */
export interface ResendReplyTarget {
  conversationKey: string;
  /** The person replies go to: the sender of the latest email. */
  to: Mailbox;
  /** Subject of the reply (`Re: ...`). */
  subject: string;
  /** Message-ID the reply answers. */
  inReplyTo?: string;
  /** References header of the reply, root first. */
  references: string[];
  /** The received email this target answers, when it comes from a turn. */
  inbound?: {
    id: string;
    content: string | AgentContentPart[];
  };
}

/** Reference to an email the adapter sent. */
export interface ResendMessageRef {
  /** Resend email id. */
  id: string;
  conversationKey: string;
  [k: string]: unknown;
}
