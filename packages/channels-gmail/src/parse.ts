import type { GmailMessage, GmailMessagePart } from "./gmail-api.js";
import { isEmailAddress } from "./mime.js";

/** An attachment on an inbound email, not yet downloaded. */
export interface InboundAttachment {
  filename: string;
  mimeType: string;
  size: number;
  /** Set when the bytes must be fetched with `attachments.get`. */
  attachmentId?: string;
  /** Set when Gmail sent the bytes inline (base64url). */
  data?: string;
}

/** The parts of an inbound email the adapter uses. */
export interface ParsedEmail {
  id: string;
  threadId: string;
  labelIds: string[];
  /** Sender address, lower case. Empty when the `From` header has none. */
  fromAddress: string;
  fromName?: string;
  /** Where a reply goes: `Reply-To` when valid, else the sender. */
  replyTo: string;
  subject: string;
  rfcMessageId?: string;
  references: string[];
  /** Plain-text body with quoted reply history removed. */
  text: string;
  attachments: InboundAttachment[];
  /** ISO time Gmail received the email. */
  receivedAt?: string;
  /** True for vacation replies, bounces, and other automatic mail (RFC 3834). */
  automatic: boolean;
}

function header(part: GmailMessagePart | undefined, name: string): string {
  const lower = name.toLowerCase();
  return (
    part?.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? ""
  );
}

/** Decode RFC 2047 encoded-words (`=?UTF-8?B?...?=`) in a header value. */
export function decodeHeaderText(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
      (_m, charset: string, enc: string, data: string) => {
        try {
          const bytes =
            enc.toUpperCase() === "B"
              ? Buffer.from(data, "base64")
              : Buffer.from(
                  data
                    .replace(/_/g, " ")
                    .replace(/=([0-9a-fA-F]{2})/g, (_x, hex: string) =>
                      String.fromCharCode(parseInt(hex, 16)),
                    ),
                  "latin1",
                );
          return new TextDecoder(charset.toLowerCase()).decode(bytes);
        } catch {
          return data;
        }
      },
    );
}

/** Split `Name <a@b.c>` into its parts. The address is lower case. */
export function parseAddress(value: string): {
  address: string;
  name?: string;
} {
  const decoded = decodeHeaderText(value).trim();
  const angle = /^(.*)<([^<>]+)>\s*$/.exec(decoded);
  const address = (angle ? angle[2]! : decoded).trim().toLowerCase();
  const name = angle?.[1]
    ?.trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  if (!isEmailAddress(address)) return { address: "" };
  return name ? { address, name } : { address };
}

function decodeBody(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

/** Walk the part tree depth first. */
function* walk(
  part: GmailMessagePart | undefined,
): Generator<GmailMessagePart> {
  if (!part) return;
  yield part;
  for (const child of part.parts ?? []) yield* walk(child);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Plain text from an HTML email body. Gmail quote blocks are removed. */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
      // Gmail, Apple Mail, and Outlook wrap quoted history in these.
      .replace(/<div[^>]*class="?[^">]*gmail_quote[\s\S]*$/i, "")
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, code: string) => {
        if (code.startsWith("#x") || code.startsWith("#X")) {
          return String.fromCodePoint(parseInt(code.slice(2), 16));
        }
        if (code.startsWith("#")) {
          return String.fromCodePoint(parseInt(code.slice(1), 10));
        }
        return ENTITIES[code.toLowerCase()] ?? m;
      })
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Lines that start the quoted part of a reply. Everything from here is cut. */
const QUOTE_MARKERS: RegExp[] = [
  // Gmail, Apple Mail: "On Mon, Jan 1, 2024 at 10:00 AM Jane <j@x.com> wrote:"
  /^On\b[\s\S]{0,300}?\bwrote:\s*$/m,
  // Outlook
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^_{10,}\s*$/m,
  /^From:\s.+\n(?:.+\n){0,3}?(?:Sent|Date):\s.+$/im,
];

/**
 * The new text of a reply: quoted history and the signature are removed.
 *
 * Removes lines that start with `>`, everything from the first reply header
 * ("On … wrote:", Outlook's "Original Message" or "From:/Sent:" block), and
 * everything after a `-- ` signature line.
 */
export function stripQuotedReply(text: string): string {
  let body = text.replace(/\r\n/g, "\n");
  let cut = body.length;
  for (const marker of QUOTE_MARKERS) {
    const m = marker.exec(body);
    if (m && m.index < cut) cut = m.index;
  }
  body = body.slice(0, cut);
  const signature = /^-- ?$/m.exec(body);
  if (signature) body = body.slice(0, signature.index);
  return body
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse a Gmail message (`format=full`) into what the adapter needs. The text
 * body comes from the first `text/plain` part, or from `text/html` when there
 * is no plain part.
 */
export function parseGmailMessage(message: GmailMessage): ParsedEmail {
  const payload = message.payload;
  let plain: string | undefined;
  let html: string | undefined;
  const attachments: InboundAttachment[] = [];
  for (const part of walk(payload)) {
    const mime = (part.mimeType ?? "").toLowerCase();
    if (part.filename) {
      attachments.push({
        filename: part.filename,
        mimeType: mime || "application/octet-stream",
        size: part.body?.size ?? 0,
        ...(part.body?.attachmentId
          ? { attachmentId: part.body.attachmentId }
          : {}),
        ...(part.body?.data ? { data: part.body.data } : {}),
      });
      continue;
    }
    if (mime === "text/plain" && plain === undefined) {
      plain = decodeBody(part.body?.data);
    } else if (mime === "text/html" && html === undefined) {
      html = decodeBody(part.body?.data);
    }
  }
  const raw = plain ?? (html !== undefined ? htmlToText(html) : "");
  const from = parseAddress(header(payload, "From"));
  const replyToHeader = parseAddress(header(payload, "Reply-To"));
  const autoSubmitted = header(payload, "Auto-Submitted").trim().toLowerCase();
  const precedence = header(payload, "Precedence").trim().toLowerCase();
  const references = header(payload, "References").split(/\s+/).filter(Boolean);
  const rfcMessageId = header(payload, "Message-ID").trim() || undefined;
  const internal = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds ?? [],
    fromAddress: from.address,
    ...(from.name ? { fromName: from.name } : {}),
    replyTo: replyToHeader.address || from.address,
    subject: decodeHeaderText(header(payload, "Subject")),
    ...(rfcMessageId ? { rfcMessageId } : {}),
    references,
    text: stripQuotedReply(raw),
    attachments,
    ...(Number.isFinite(internal) && internal > 0
      ? { receivedAt: new Date(internal).toISOString() }
      : {}),
    automatic:
      (autoSubmitted !== "" && autoSubmitted !== "no") ||
      ["bulk", "junk", "auto_reply"].includes(precedence) ||
      header(payload, "X-Autoreply") !== "",
  };
}
