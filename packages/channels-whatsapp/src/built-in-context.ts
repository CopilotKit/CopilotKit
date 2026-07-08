import type { ContextEntry } from "@copilotkit/channels";

/** Tell the model it's on WhatsApp and which formatting actually renders. */
export const whatsAppFormattingContext: ContextEntry = {
  description: "WhatsApp message formatting rules",
  value:
    "You are replying inside WhatsApp. Use Markdown normally; it is converted " +
    "to WhatsApp formatting: **bold**, *italic*/_italic_, ~~strikethrough~~, and " +
    "`code`/```code blocks```. WhatsApp has no headings, tables, or clickable " +
    "Markdown links — links render as plain text, so write 'label (https://url)'. " +
    "Keep replies concise; long messages are split.",
};

/** WhatsApp messages cannot be edited — there is no token-by-token streaming. */
export const whatsAppDeliveryContext: ContextEntry = {
  description: "WhatsApp message delivery constraints",
  value:
    "Replies are delivered as a single finished message (no live streaming/edits). " +
    "Do not promise to 'update this message'; post a new message instead.",
};

export const defaultWhatsAppContext: ContextEntry[] = [
  whatsAppFormattingContext,
  whatsAppDeliveryContext,
];
