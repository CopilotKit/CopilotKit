import type { HistoryStore } from "./history-store.js";
import type { FileDeliveryConfig } from "./download-files.js";

/** Where a reply goes: a WhatsApp user (wa_id) reachable via a business number. */
export interface ReplyTarget {
  /** Recipient wa_id (the user's phone number in E.164 without '+'). */
  to: string;
  /** The business phone-number id that sends the message. */
  phoneNumberId: string;
}

/** A WhatsApp message ref (the Cloud API message id, `wamid.*`). */
export interface WhatsAppMessageRef {
  id: string;
  to: string;
  phoneNumberId: string;
  [k: string]: unknown;
}

export interface WhatsAppAdapterOptions {
  /** Cloud API access token (Bearer). */
  accessToken: string;
  /** Business phone-number id that sends messages. */
  phoneNumberId: string;
  /** App secret used to validate X-Hub-Signature-256 on inbound POSTs. */
  appSecret: string;
  /** Token echoed during the GET verification handshake (hub.verify_token). */
  verifyToken: string;
  /** HTTP server port (default 3000). */
  port?: number;
  /** Webhook path (default "/webhook"). */
  path?: string;
  /** Graph API version (default "v21.0"). */
  apiVersion?: string;
  /** Graph API base origin (default "https://graph.facebook.com"). Overridable for tests. */
  graphBaseUrl?: string;
  /** Custom-event names treated as interrupts by the run renderer. */
  interruptEventNames?: ReadonlySet<string>;
  /** Prefix for leading-keyword command matching (default "/"). */
  commandPrefix?: string;
  /** Pluggable conversation-history persistence (default InMemoryHistoryStore). */
  historyStore?: HistoryStore;
  /** Inbound media handling config. */
  files?: FileDeliveryConfig;
}

/** A single inbound message object from the Cloud API webhook. */
export interface InboundMessage {
  from: string; // sender wa_id
  id: string; // wamid
  timestamp?: string;
  type: string; // "text" | "interactive" | "image" | "audio" | "document" | "video" | ...
  /** Present when this message quote-replies another; `id` is the quoted message's wamid. */
  context?: { id?: string; from?: string };
  text?: { body: string };
  interactive?: {
    type: "button_reply" | "list_reply";
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  image?: InboundMedia;
  audio?: InboundMedia;
  video?: InboundMedia;
  document?: InboundMedia;
}

export interface InboundMedia {
  id: string;
  mime_type?: string;
  sha256?: string;
  filename?: string;
  caption?: string;
}

/** The `value` object inside `entry[].changes[]`. */
export interface ChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: InboundMessage[];
  statuses?: unknown[];
}

/** Top-level webhook POST body. */
export interface WebhookBody {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ value?: ChangeValue }> }>;
}
