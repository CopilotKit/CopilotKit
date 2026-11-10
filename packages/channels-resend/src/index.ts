export { resend, ResendAdapter, RESEND_MAX_EMAIL_BYTES } from "./adapter.js";
export type {
  ResendActionLinkOptions,
  ResendAdapterOptions,
  ResendMessageRef,
  ResendReplyTarget,
} from "./types.js";
export type { ResendFileOptions } from "./attachments.js";
export { ResendClient, ResendApiError, RESEND_API_URL } from "./client.js";
export type {
  ResendClientOptions,
  ResendOutboundAttachment,
  ResendReceivedAttachment,
  ResendReceivedEmail,
  ResendSendPayload,
} from "./client.js";
export {
  verifyWebhook,
  signWebhook,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./svix.js";
export type { VerifyWebhookArgs, WebhookVerifyResult } from "./svix.js";
export {
  ACTION_PARAM,
  DEFAULT_ACTION_LINK_TTL_MS,
  signActionLink,
  verifyActionLink,
} from "./action-links.js";
export type { ActionLinkClaims, ActionLinkResult } from "./action-links.js";
export { renderEmail, renderMarkdownEmail } from "./render.js";
export type { EmailBody, EmailControl, RenderOptions } from "./render.js";
export { extractReplyText } from "./quote.js";
export type { Mailbox } from "./threading.js";
