import type { HistoryStore } from "./history-store.js";

/** Where to post a reply in Google Chat. Built by ingress for every event. */
export interface ReplyTarget {
  /** Space resource name, e.g. "spaces/AAAA". */
  space: string;
  /**
   * Thread resource name ("spaces/AAAA/threads/TTTT") to reply into. Omitted
   * in a direct message, where replies post as new messages in the space.
   */
  thread?: string;
}

/** A posted Google Chat message. `id` is the message resource name. */
export interface GoogleChatMessageRef {
  /** Message resource name, e.g. "spaces/AAAA/messages/MMMM". */
  id: string;
  space: string;
  thread?: string;
  [k: string]: unknown;
}

export interface GoogleChatAdapterOptions {
  /**
   * Service-account credentials used to call the Chat REST API: a parsed key
   * object, an inline JSON string, or a path to the key file. Falls back to
   * `GOOGLE_CHAT_CREDENTIALS`, then to Application Default Credentials.
   */
  credentials?: object | string;
  /**
   * GCP project number. Verifies webhooks from a Chat app whose
   * "Authentication audience" is "Project number".
   */
  googleChatProjectNumber?: string;
  /**
   * Public HTTPS URL of this webhook, exactly as configured in the Chat app.
   * Verifies webhooks from a Chat app whose "Authentication audience" is
   * "HTTP endpoint URL" (the default for Workspace add-on Chat apps).
   *
   * It is also the `function` that card buttons call on add-on Chat apps:
   * those apps route a click to a URL, not to a function name.
   */
  endpointUrl?: string;
  /**
   * Your add-on's own service account,
   * `service-<projectNumber>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`.
   * Required to accept endpoint-URL tokens that a Workspace add-on Chat app
   * signs. Tokens from any other add-on are rejected.
   */
  workspaceAddOnServiceAccountEmail?: string;
  /** Skip webhook signature verification. LOCAL DEVELOPMENT ONLY. */
  disableSignatureVerification?: boolean;
  /**
   * Your Chat app's own user resource name ("users/123…"). Optional. When set,
   * an @-mention is detected by exact id; otherwise any BOT mention counts.
   */
  botUserId?: string;
  /**
   * Port for a self-hosted HTTP server. Omit it to mount
   * `adapter.requestHandler` / `adapter.nodeHandler` on your own server.
   */
  port?: number;
  /** Webhook path for the self-hosted server (default "/"). */
  path?: string;
  /** Override the Chat REST base URL (tests). Default https://chat.googleapis.com/v1. */
  apiUrl?: string;
  /** Show tool-call status rows during a run. Default true. */
  showToolStatus?: boolean;
  /** Custom-event names the run renderer treats as interrupts. */
  interruptEventNames?: ReadonlySet<string>;
  /**
   * Conversation-history persistence. Default: in memory. Google Chat only
   * lets an app read history with extra admin-approved scopes, so the adapter
   * keeps its own transcript and replays it to the agent each turn.
   */
  historyStore?: HistoryStore;
}

/**
 * Stable conversation key shared by ingress and interaction decoding, so an
 * `awaitChoice` waiter resolves. A space thread is its own conversation; a
 * direct message is one conversation for the whole space.
 */
export function conversationKeyOf(space: string, thread?: string): string {
  return thread ? `gchat:${thread}` : `gchat:${space}`;
}
