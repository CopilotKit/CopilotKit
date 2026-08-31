/**
 * Inbound file transport. Slack messages can carry uploaded `files`; this
 * turns them into AG-UI multimodal message content the agent's model can
 * read — images, audio, video, and PDFs as their respective binary parts,
 * and text/CSV/JSON as decoded `text` parts — downloading each from its
 * (private) `url_private` with the bot token.
 *
 * The bridge is transport-only: it delivers the bytes/text to the agent and
 * lets the app decide what to do with them. Anything it can't represent is
 * skipped with a short note so the agent knows a file was dropped and why.
 */
import type { WebClient } from "@slack/web-api";

/** The subset of a Slack file object we use. */
export interface SlackFileRef {
  id?: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  url_private?: string;
  size?: number;
}

/** A base64 data source, shared by every binary media part. */
type MediaDataSource = { type: "data"; value: string; mimeType: string };

/**
 * AG-UI multimodal content parts (shape the runtime's converter expects).
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
  /** Skip a single file larger than this many bytes. Default 8 MiB. */
  maxBytesPerFile?: number;
  /** Process at most this many files per message. Default 5. */
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

/**
 * The AG-UI media part type that carries this MIME, or null if it isn't a
 * binary medium we pass through. Images/audio/video go by their top-level
 * type; PDFs map to `document`. Everything else is left to the text path or
 * skipped.
 */
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
 * Download a message's files and turn them into AG-UI content parts. Returns
 * the parts plus human-readable `notes` for anything skipped (appended to the
 * message as a text part by the caller).
 */
export async function buildFileContentParts(
  files: SlackFileRef[],
  botToken: string,
  config: FileDeliveryConfig = {},
): Promise<{ parts: AgentContentPart[]; notes: string[] }> {
  const maxBytes = config.maxBytesPerFile ?? DEFAULTS.maxBytesPerFile;
  const maxFiles = config.maxFiles ?? DEFAULTS.maxFiles;
  const maxText = config.maxTextBytes ?? DEFAULTS.maxTextBytes;

  const parts: AgentContentPart[] = [];
  const notes: string[] = [];
  const considered = files.slice(0, maxFiles);
  if (files.length > maxFiles) {
    notes.push(
      `(only the first ${maxFiles} of ${files.length} files processed)`,
    );
  }

  for (const f of considered) {
    const label = f.name ?? f.id ?? "file";
    const mime = (f.mimetype ?? "").toLowerCase();
    const media = mediaPartType(mime);
    if (!f.url_private) {
      notes.push(`skipped "${label}": no download URL`);
      continue;
    }
    if (!media && !isText(mime)) {
      notes.push(
        `skipped "${label}" (${mime || f.filetype || "unknown"}): unsupported type`,
      );
      continue;
    }
    if (typeof f.size === "number" && f.size > maxBytes) {
      notes.push(
        `skipped "${label}": ${f.size} bytes exceeds the ${maxBytes}-byte cap`,
      );
      continue;
    }

    let bytes: Buffer;
    try {
      const res = await fetch(f.url_private, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      if (!res.ok) {
        notes.push(`skipped "${label}": download failed (HTTP ${res.status})`);
        continue;
      }
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      notes.push(`skipped "${label}": ${(err as Error).message}`);
      continue;
    }
    if (bytes.byteLength > maxBytes) {
      notes.push(
        `skipped "${label}": ${bytes.byteLength} bytes exceeds the ${maxBytes}-byte cap`,
      );
      continue;
    }

    if (media) {
      // Image/audio/video/PDF → a binary data part the model reads natively
      // (subject to its modality support). The bridge just delivers it.
      parts.push({
        type: media,
        source: {
          type: "data",
          value: bytes.toString("base64"),
          mimeType: mime,
        },
      });
    } else {
      // Truncate the BYTES then decode — slicing the decoded string by
      // character index would corrupt multi-byte UTF-8 (and not actually
      // bound the byte length). toString drops any malformed trailing bytes.
      let buf = bytes;
      let truncated = false;
      if (buf.byteLength > maxText) {
        buf = buf.subarray(0, maxText);
        truncated = true;
      }
      const text = buf.toString("utf8");
      parts.push({
        type: "text",
        text:
          `Attached file "${label}" (${mime}${truncated ? ", truncated" : ""}):\n` +
          text,
      });
    }
  }

  return { parts, notes };
}
