/**
 * Inbound file transport. Discord messages can carry attachments; this turns
 * them into AG-UI multimodal message content the agent's model can read —
 * images as binary data parts and plain text/CSV/JSON/etc. as decoded `text`
 * parts — downloading each from its public CDN URL (no auth required).
 *
 * The AgentContentPart union is intentionally identical to bot-slack's so the
 * agent sees the same multimodal input shape across both adapters.
 */

/** The subset of a Discord attachment we use. */
export interface DiscordAttachmentRef {
  /** CDN URL — publicly fetchable, no auth header needed. */
  url: string;
  /** Original filename, used for extension-based MIME fallback. */
  name: string;
  /** MIME type reported by Discord (may be null/undefined for some uploads). */
  contentType?: string | null;
  /** Byte length reported by Discord. Used to gate the size cap pre-fetch. */
  size: number;
}

/** A base64 data source, shared by every binary media part. */
export type MediaDataSource = { type: "data"; value: string; mimeType: string };

/**
 * AG-UI multimodal content parts — SAME shape as bot-slack emits so the agent
 * sees identical multimodal input across both adapters.
 *
 * Binary media (image/audio/video/document) is passed straight through as a
 * data part; the agent's model decides what it can actually consume. Most
 * models read images and PDFs; far fewer accept audio or video. The bridge
 * stays transport-only and does not gate on model capability.
 */
export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: MediaDataSource }
  | { type: "audio"; source: MediaDataSource }
  | { type: "video"; source: MediaDataSource }
  | { type: "document"; source: MediaDataSource };

/** Tunables for inbound file handling (all optional; sane defaults). */
export interface FileDeliveryConfig {
  /**
   * Skip a single file larger than this many bytes without fetching it.
   * Default 10 MiB.
   */
  maxBytes?: number;
  /**
   * Truncate decoded text files to this many bytes before injecting them into
   * the prompt (keeps a large text upload from blowing the token budget).
   * Default 200 KiB.
   */
  maxTextBytes?: number;
  /**
   * Process at most this many attachments per message. Extra attachments beyond
   * this cap are ignored without fetching, bounding the multimodal payload /
   * token budget a single message can inject. Default 5.
   */
  maxFiles?: number;
  /**
   * Inject a custom fetch implementation (for testing or environments without
   * the global `fetch`).
   */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_BYTES = 10_000_000; // 10 MiB
const DEFAULT_MAX_TEXT_BYTES = 200_000; // ~200 KiB
const DEFAULT_MAX_FILES = 5;

/** File extensions that indicate decodable plain text even when MIME is absent. */
const TEXT_EXT_RE = /\.(txt|csv|json|md|log|tsv|ya?ml)$/i;

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/csv" ||
    mime === "application/xml" ||
    mime === "application/x-ndjson" ||
    mime === "application/yaml"
  );
}

function mediaPartType(
  mime: string,
): "image" | "audio" | "video" | "document" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "document";
  return null;
}

/**
 * Download Discord message attachments and convert them to AG-UI content parts.
 *
 * Files whose reported size exceeds `maxBytes` are skipped WITHOUT fetching;
 * the actual downloaded byte length is re-checked against the same cap after
 * fetching. Images map to an image part; text/* MIME types and text-named
 * files (.txt, .csv, .json, .md, .log, .tsv, .yaml) — including ones reported
 * with a generic binary MIME like application/octet-stream — map to a text
 * part (truncated to `maxTextBytes`); other binary content is skipped with a
 * short text note explaining why (bot-slack parity), so the model knows a file
 * was dropped.
 *
 * At most `maxFiles` attachments (default 5) are processed; any beyond that cap
 * are ignored without fetching, bounding the multimodal payload a single
 * message can inject.
 */
export async function buildFileContentParts(
  attachments: readonly DiscordAttachmentRef[],
  cfg: FileDeliveryConfig = {},
): Promise<AgentContentPart[]> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const maxBytes = cfg.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxTextBytes = cfg.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;
  const maxFiles = cfg.maxFiles ?? DEFAULT_MAX_FILES;
  const parts: AgentContentPart[] = [];

  // Cap the number of attachments processed per message before any fetching,
  // bounding the multimodal payload / token budget (bot-slack parity).
  for (const att of attachments.slice(0, maxFiles)) {
    // Gate on the reported size — skip (without fetching) if it exceeds the cap.
    // Surface the skip as a note so the model knows a file was dropped and why
    // (bot-slack parity).
    if (att.size > maxBytes) {
      parts.push({
        type: "text",
        text: `[attachment "${att.name}" skipped: ~${Math.round(att.size / 1e6)} MB exceeds the ${Math.round(maxBytes / 1e6)} MB limit]`,
      });
      continue;
    }

    const mime = (att.contentType ?? "").toLowerCase().split(";")[0]!.trim();
    const media = mediaPartType(mime);
    const textMime = isTextMime(mime);
    // Treat a recognized text extension as text whenever the MIME isn't a
    // medium we pass through and isn't itself a text MIME — this also covers
    // generic/unrecognized binary types (e.g. application/octet-stream) that
    // Discord sometimes reports for .csv/.json/etc. uploads.
    const textName = !media && !textMime && TEXT_EXT_RE.test(att.name);

    // Skip binary types we don't represent — surface as a note.
    if (!media && !textMime && !textName) {
      parts.push({
        type: "text",
        text: `[attachment "${att.name}" skipped: unsupported type ${mime || "unknown"}]`,
      });
      continue;
    }

    let res: Response;
    try {
      res = await fetchImpl(att.url);
    } catch {
      parts.push({
        type: "text",
        text: `[attachment "${att.name}" skipped: download failed]`,
      });
      continue;
    }
    if (!res.ok) {
      parts.push({
        type: "text",
        text: `[attachment "${att.name}" skipped: download failed]`,
      });
      continue;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());

    // Double-check the actual downloaded size — the reported `att.size` can
    // lie (or be absent), so re-gate on the real byte length.
    if (bytes.length > maxBytes) {
      parts.push({
        type: "text",
        text: `[attachment "${att.name}" skipped: ~${Math.round(bytes.length / 1e6)} MB exceeds the ${Math.round(maxBytes / 1e6)} MB limit]`,
      });
      continue;
    }

    if (media) {
      // Binary media part — base64-encoded, exact same shape as bot-slack.
      const effectiveMime = mime || `application/octet-stream`;
      parts.push({
        type: media,
        source: {
          type: "data",
          value: Buffer.from(bytes).toString("base64"),
          mimeType: effectiveMime,
        },
      });
    } else {
      // Text content — truncate the BYTES then decode (slicing the decoded
      // string by character index would corrupt multi-byte UTF-8 and wouldn't
      // actually bound the byte length). Append a note when truncated.
      let buf = bytes;
      let truncated = false;
      if (buf.length > maxTextBytes) {
        buf = buf.subarray(0, maxTextBytes);
        truncated = true;
      }
      const text = new TextDecoder("utf-8").decode(buf);
      parts.push({
        type: "text",
        text:
          `Attached file "${att.name}" (${mime || "text"}${truncated ? ", truncated" : ""}):\n` +
          text +
          (truncated ? "\n…(truncated)" : ""),
      });
    }
  }

  return parts;
}
