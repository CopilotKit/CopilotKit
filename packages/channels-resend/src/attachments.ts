import type { AgentContentPart } from "@copilotkit/channels-ui";
import type { ResendClient, ResendReceivedAttachment } from "./client.js";

/** Limits for inbound attachments. */
export interface ResendFileOptions {
  /** Skip a file larger than this many bytes. Default 8 MiB. */
  maxBytesPerFile?: number;
  /** Use at most this many attachments per email. Default 5. */
  maxFiles?: number;
  /** Cut text files to this many bytes. Default 200 KiB. */
  maxTextBytes?: number;
  /**
   * Also pass inline attachments (images embedded in the HTML, often logos
   * in signatures). Default `false`.
   */
  includeInline?: boolean;
}

const DEFAULTS = {
  maxBytesPerFile: 8 * 1024 * 1024,
  maxFiles: 5,
  maxTextBytes: 200 * 1024,
  includeInline: false,
} as const;

const TEXT_TYPES = new Set([
  "application/json",
  "application/csv",
  "application/xml",
  "application/x-ndjson",
  "application/yaml",
]);

function isText(mime: string): boolean {
  return mime.startsWith("text/") || TEXT_TYPES.has(mime);
}

function mediaKind(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/**
 * Download a received email's attachments and turn them into AG-UI content
 * parts. Text files become text parts (cut to `maxTextBytes`); everything
 * else becomes a base64 data part. Files over the limits are skipped, and
 * each skip is listed in `notes`.
 */
export async function buildAttachmentParts(
  emailId: string,
  client: Pick<ResendClient, "listReceivedAttachments" | "download">,
  options: ResendFileOptions = {},
): Promise<{ parts: AgentContentPart[]; notes: string[] }> {
  const cfg = { ...DEFAULTS, ...options };
  const parts: AgentContentPart[] = [];
  const notes: string[] = [];
  let attachments: ResendReceivedAttachment[];
  try {
    attachments = await client.listReceivedAttachments(emailId);
  } catch (err) {
    return {
      parts,
      notes: [`could not list attachments: ${(err as Error).message}`],
    };
  }
  const usable = attachments.filter(
    (a) => cfg.includeInline || a.content_disposition !== "inline",
  );
  for (const attachment of usable.slice(0, cfg.maxFiles)) {
    const name = attachment.filename ?? attachment.id;
    if ((attachment.size ?? 0) > cfg.maxBytesPerFile) {
      notes.push(`${name} skipped: larger than ${cfg.maxBytesPerFile} bytes`);
      continue;
    }
    if (!attachment.download_url) {
      notes.push(`${name} skipped: no download URL`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await client.download(
        attachment.download_url,
        cfg.maxBytesPerFile,
      );
    } catch (err) {
      notes.push(`${name} skipped: ${(err as Error).message}`);
      continue;
    }
    const mime = (attachment.content_type ?? "application/octet-stream")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (isText(mime)) {
      const text = new TextDecoder().decode(bytes.slice(0, cfg.maxTextBytes));
      parts.push({ type: "text", text: `Attachment ${name}:\n${text}` });
      continue;
    }
    parts.push({
      type: mediaKind(mime),
      source: {
        type: "data",
        value: Buffer.from(bytes).toString("base64"),
        mimeType: mime,
      },
    });
  }
  if (usable.length > cfg.maxFiles) {
    notes.push(
      `${usable.length - cfg.maxFiles} more attachments skipped (limit ${cfg.maxFiles})`,
    );
  }
  return { parts, notes };
}
