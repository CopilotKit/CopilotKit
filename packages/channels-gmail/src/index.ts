export { gmail, GmailAdapter, GMAIL_MAX_ATTACHMENT_BYTES } from "./adapter.js";
export type {
  GmailActionLinkOptions,
  GmailAdapterOptions,
  GmailFileOptions,
  GmailMessageRef,
  GmailOAuthCredentials,
  GmailReplyTarget,
} from "./types.js";
export { GmailApiError, GmailClient } from "./gmail-api.js";
export { renderEmail } from "./render.js";
export type { EmailBody } from "./render.js";
export { stripQuotedReply } from "./parse.js";
