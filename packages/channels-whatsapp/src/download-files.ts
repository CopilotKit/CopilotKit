import type { WhatsAppClient } from "./client.js";

type MediaDataSource = { type: "data"; value: string; mimeType: string };

/** AG-UI multimodal content parts (shape the runtime's converter expects). */
export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: MediaDataSource }
  | { type: "audio"; source: MediaDataSource }
  | { type: "video"; source: MediaDataSource }
  | { type: "document"; source: MediaDataSource };

/** Subset of an inbound media object we use. */
export interface WhatsAppMediaRef {
  id: string;
  mime_type?: string;
  filename?: string;
}

export interface FileDeliveryConfig {
  /** Skip a single file larger than this many bytes. Default 8 MiB. */
  maxBytesPerFile?: number;
  /** Process at most this many media per message. Default 5. */
  maxFiles?: number;
  /** Truncate decoded text files to this many bytes. Default 200 KiB. */
  maxTextBytes?: number;
}

const DEFAULTS = {
  maxBytesPerFile: 8 * 1024 * 1024,
  maxFiles: 5,
  maxTextBytes: 200 * 1024,
} as const;

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/csv",
  "application/xml",
  "application/x-ndjson",
  "application/yaml",
]);

function isText(mime: string): boolean {
  return (
    TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p)) ||
    TEXT_MIME_EXACT.has(mime)
  );
}

function mediaKind(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/** Download inbound media via the client and build AG-UI content parts. */
export async function buildFileContentParts(
  media: WhatsAppMediaRef[],
  client: Pick<WhatsAppClient, "downloadMedia">,
  config: FileDeliveryConfig,
): Promise<{ parts: AgentContentPart[]; notes: string[] }> {
  const cfg = { ...DEFAULTS, ...config };
  const parts: AgentContentPart[] = [];
  const notes: string[] = [];

  // WhatsApp delivers one media object per inbound message, so the ingress path
  // passes a single-element array today. The maxFiles clamp/overflow note exists
  // for callers that batch multiple media (e.g. future album support).
  for (const m of media.slice(0, cfg.maxFiles)) {
    let dl;
    try {
      dl = await client.downloadMedia(m.id);
    } catch (err) {
      notes.push(`failed to download ${m.id}: ${(err as Error).message}`);
      continue;
    }
    if (dl.bytes.byteLength > cfg.maxBytesPerFile) {
      notes.push(`media ${m.id} too large (${dl.bytes.byteLength} bytes)`);
      continue;
    }
    const mime = m.mime_type ?? dl.mimeType;
    if (isText(mime)) {
      const slice = dl.bytes.slice(0, cfg.maxTextBytes);
      parts.push({ type: "text", text: new TextDecoder().decode(slice) });
      continue;
    }
    parts.push({
      type: mediaKind(mime),
      source: { type: "data", value: base64(dl.bytes), mimeType: mime },
    } as AgentContentPart);
  }

  if (media.length > cfg.maxFiles) {
    notes.push(
      `dropped ${media.length - cfg.maxFiles} extra media (limit ${cfg.maxFiles})`,
    );
  }
  return { parts, notes };
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
