/** Where to post a reply in Google Chat. Constructed by the listener per turn. */
export interface ReplyTarget {
  /** Space resource name, e.g. "spaces/AAAA". */
  space: string;
  /**
   * Thread id to reply into ("spaces/AAAA/threads/TTTT"), omitted for a new
   * top-level message. For threaded replies we pass this as the message's
   * `thread.name` with `messageReplyOption`.
   */
  thread?: string;
  /** Display name of the turn sender (for logging/diagnostics). */
  senderName?: string;
}

/**
 * Stable key for one ongoing conversation.
 * - Space thread: `{ spaceId, scope: "<thread resource name>" }`
 * - DM:           `{ spaceId, scope: "dm" }`
 */
export interface ConversationKey {
  spaceId: string;
  scope: string;
}

/** Sentinel scope for DMs (no thread). */
export const DM_SCOPE = "dm";

/** What the listener emits per turn; downstream code never sees Chat event shapes. */
export interface IncomingTurn {
  conversation: ConversationKey;
  replyTarget: ReplyTarget;
  userText: string;
  /** Chat user resource name of the sender, e.g. "users/12345". */
  senderUserId?: string;
  /** Display name of the sender, if the event carried it. */
  senderName?: string;
}

export interface GoogleChatAdapterOptions {
  /** Service account credentials JSON (object) or path to the key file. */
  credentials?: object | string;
  /** Use Application Default Credentials instead of explicit credentials. */
  useApplicationDefaultCredentials?: boolean;
  /** GCP project number — expected `aud` of inbound webhook JWTs. */
  googleChatProjectNumber?: string;
  /** Override the expected inbound JWT audience (defaults to googleChatProjectNumber). */
  audience?: string;
  /** Disable inbound signature verification (LOCAL DEV ONLY). */
  disableSignatureVerification?: boolean;
  /** Admin email for domain-wide delegation — enables getMessages + DMs history. */
  impersonateUser?: string;
  /** Port for the self-hosted HTTP server. Omit to use `requestHandler` only. */
  port?: number;
  /** Override the Chat REST base URL (testing). Defaults to https://chat.googleapis.com/v1 */
  apiUrl?: string;
  /** "edit" (default) edit-in-place streaming, or "off". */
  streaming?: "edit" | "off";
  /** Surface tool-status rows during a run. Default true. */
  showToolStatus?: boolean;
  /** Custom-event names treated as interrupts by the run renderer. */
  interruptEventNames?: ReadonlySet<string>;
}

/** Stable key shared by ingress and interaction decoding. Single source of truth. */
export function conversationKeyOf(key: ConversationKey): string {
  return `${key.spaceId}::${key.scope}`;
}
