import type { AgentContentPart } from "@copilotkit/channels-ui";
import type { InboundAttachment } from "./parse.js";
import type { GmailFileOptions } from "./types.js";

export const FILE_DEFAULTS = {
  maxBytesPerFile: 8 * 1024 * 1024,
  maxFiles: 5,
  maxTextBytes: 200 * 1024,
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

function kind(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/**
 * Download inbound attachments and turn them into AG-UI content parts. Text
 * files become text parts (cut to `maxTextBytes`); other files become data
 * parts. Files over the size cap, and files past `maxFiles`, are skipped with
 * a note.
 */
export async function attachmentParts(
  attachments: readonly InboundAttachment[],
  download: (attachmentId: string) => Promise<Uint8Array>,
  options: GmailFileOptions = {},
): Promise<{ parts: AgentContentPart[]; notes: string[] }> {
  const cfg = { ...FILE_DEFAULTS, ...options };
  const parts: AgentContentPart[] = [];
  const notes: string[] = [];
  for (const file of attachments.slice(0, cfg.maxFiles)) {
    if (file.size > cfg.maxBytesPerFile) {
      notes.push(
        `skipped ${file.filename}: larger than ${cfg.maxBytesPerFile} bytes`,
      );
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = file.data
        ? Buffer.from(file.data, "base64url")
        : file.attachmentId
          ? await download(file.attachmentId)
          : new Uint8Array();
    } catch (err) {
      notes.push(
        `could not download ${file.filename}: ${(err as Error).message}`,
      );
      continue;
    }
    if (bytes.byteLength > cfg.maxBytesPerFile) {
      notes.push(
        `skipped ${file.filename}: larger than ${cfg.maxBytesPerFile} bytes`,
      );
      continue;
    }
    if (isText(file.mimeType)) {
      const text = new TextDecoder().decode(bytes.slice(0, cfg.maxTextBytes));
      parts.push({ type: "text", text: `${file.filename}:\n${text}` });
      continue;
    }
    parts.push({
      type: kind(file.mimeType),
      source: {
        type: "data",
        value: Buffer.from(bytes).toString("base64"),
        mimeType: file.mimeType,
      },
    });
  }
  if (attachments.length > cfg.maxFiles) {
    notes.push(
      `skipped ${attachments.length - cfg.maxFiles} more attachments (limit ${cfg.maxFiles})`,
    );
  }
  return { parts, notes };
}
