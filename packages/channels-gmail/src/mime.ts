import { randomUUID } from "node:crypto";

/** One file attached to an outbound email. */
export interface MimeAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface ReplyMimeInput {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  /** `Message-ID` of the email being answered. */
  inReplyTo?: string;
  /** `References` of the email being answered. */
  references?: readonly string[];
  text: string;
  html: string;
  attachments?: readonly MimeAttachment[];
}

/** Simple address check: one `local@domain`, no spaces, brackets, or line breaks. */
const ADDRESS = /^[^\s<>()[\]\\,;:"@]+@[^\s<>()[\]\\,;:"@]+$/;
/** A `Message-ID` in angle brackets, without spaces or line breaks. */
const MESSAGE_ID = /^<[^\s<>]+>$/;

export function isEmailAddress(value: string): boolean {
  return ADDRESS.test(value);
}

/** Remove line breaks and other control characters from a header value. */
function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

/** RFC 2047 encoded-word for a header value that is not plain ASCII. */
export function encodeHeaderText(value: string): string {
  const clean = oneLine(value);
  if (/^[ -~]*$/.test(clean)) return clean;
  // Split on whole characters so no encoded-word cuts a UTF-8 sequence.
  const words: string[] = [];
  let chunk = "";
  for (const char of clean) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return (
    words
      .map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`)
      // Fold between encoded words so a long subject keeps lines short.
      .join("\r\n ")
  );
}

/** `"Name" <address>` with the name encoded and the address checked. */
export function formatAddress(address: string, name?: string): string {
  const addr = oneLine(address);
  if (!isEmailAddress(addr)) {
    throw new Error(`not a valid email address: ${JSON.stringify(address)}`);
  }
  if (!name) return addr;
  const display = encodeHeaderText(name);
  // A plain-ASCII name is quoted. Escape the quote and backslash.
  const quoted = display.startsWith("=?")
    ? display
    : `"${display.replace(/[\\"]/g, "\\$&")}"`;
  return `${quoted} <${addr}>`;
}

/** Reply subject: `Re: <subject>`, without stacking a second `Re:`. */
export function replySubject(subject: string): string {
  const clean = oneLine(subject);
  if (!clean) return "Re:";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

/** Keep only well-formed message ids, so a bad header cannot inject lines. */
export function cleanMessageIds(ids: readonly string[]): string[] {
  return ids.map((id) => id.trim()).filter((id) => MESSAGE_ID.test(id));
}

/** Base64 with lines of at most 76 characters, as MIME requires. */
function base64Lines(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString("base64");
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** A file name without path separators, quotes, or control characters. */
function cleanFilename(filename: string): string {
  return oneLine(filename).replace(/[\\/"]/g, "_") || "attachment";
}

/** The file name with every non-ASCII character replaced. */
function asciiFilename(filename: string): string {
  return cleanFilename(filename).replace(/[^ -~]/g, "_");
}

/** `Content-Disposition` file name, RFC 2231 encoded when not plain ASCII. */
function filenameParams(filename: string): string {
  const clean = cleanFilename(filename);
  const ascii = asciiFilename(filename);
  if (ascii === clean) return `filename="${ascii}"`;
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/** Only `type/subtype` survives; anything else becomes octet-stream. */
function cleanContentType(value: string): string {
  return /^[\w.+-]+\/[\w.+-]+$/.test(value)
    ? value
    : "application/octet-stream";
}

function boundary(): string {
  return `ck_${randomUUID().replace(/-/g, "")}`;
}

/**
 * Build a reply email as raw RFC 5322 bytes.
 *
 * The body is `multipart/alternative` (plain text and HTML). With
 * attachments, that sits inside `multipart/mixed`. Threading headers
 * (`In-Reply-To`, `References`) keep the reply in the sender's thread.
 * Every header value is cleaned of line breaks, so caller data cannot add
 * headers.
 */
export function buildReplyMime(input: ReplyMimeInput): Buffer {
  const headers: string[] = [
    `From: ${formatAddress(input.from, input.fromName)}`,
    `To: ${formatAddress(input.to)}`,
    `Subject: ${encodeHeaderText(replySubject(input.subject))}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@channels.copilotkit>`,
    "MIME-Version: 1.0",
    // RFC 3834: tells other auto-responders not to answer this email.
    "Auto-Submitted: auto-replied",
  ];
  const inReplyTo = input.inReplyTo
    ? cleanMessageIds([input.inReplyTo])[0]
    : undefined;
  if (inReplyTo) {
    const refs = cleanMessageIds(input.references ?? []);
    if (!refs.includes(inReplyTo)) refs.push(inReplyTo);
    headers.push(`In-Reply-To: ${inReplyTo}`);
    // Fold between ids: a long thread would pass the 998-character line limit.
    headers.push(`References: ${refs.join("\r\n ")}`);
  }

  const altBoundary = boundary();
  const alternative = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(input.text)),
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(input.html)),
    `--${altBoundary}--`,
  ].join("\r\n");

  const attachments = input.attachments ?? [];
  let body: string;
  if (attachments.length === 0) {
    headers.push(
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    );
    body = alternative;
  } else {
    const mixedBoundary = boundary();
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    const parts = [
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      alternative,
    ];
    for (const file of attachments) {
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${cleanContentType(file.contentType)}; name="${asciiFilename(file.filename)}"`,
        `Content-Disposition: attachment; ${filenameParams(file.filename)}`,
        "Content-Transfer-Encoding: base64",
        "",
        base64Lines(file.bytes),
      );
    }
    parts.push(`--${mixedBoundary}--`);
    body = parts.join("\r\n");
  }
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`);
}

/** Guess a content type from a file name. */
export function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    html: "text/html",
    zip: "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}
