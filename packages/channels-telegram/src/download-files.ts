/**
 * Inbound file transport. Telegram messages can carry file attachments; this
 * turns them into AG-UI multimodal message content the agent's model can
 * read — images, audio, video, and documents as their respective binary parts —
 * downloading each from the Telegram Bot API file endpoint.
 *
 * The bridge is transport-only: it delivers the bytes to the agent and lets
 * the app decide what to do with them. Anything it can't represent is skipped
 * with a short note so the agent knows a file was dropped and why.
 */

/** The subset of a Telegram file object we use. */
export interface TelegramFileRef {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
}

/** A base64 data source, shared by every binary media part. */
type MediaDataSource = { type: "data"; value: string; mimeType: string };

/**
 * AG-UI multimodal content parts (shape the runtime's converter expects).
 *
 * Binary media (image/audio/video/document) is passed straight through as a
 * data part; the agent's model decides what it can actually consume.
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
}

/** Redact all occurrences of `token` from `msg` so the bot secret never leaks into notes. */
function redactToken(msg: string, token: string): string {
  if (!token) return msg;
  return msg.split(token).join("<redacted>");
}

const DEFAULTS = {
  maxBytesPerFile: 8 * 1024 * 1024,
  maxFiles: 5,
} as const;

/**
 * The AG-UI media part type that carries this MIME, or "document" as fallback.
 * Images/audio/video go by their top-level type; everything else is document.
 */
function mediaPartType(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/** Non-`text/*` MIME types that are still UTF-8 text the model should read. */
const TEXT_APP_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/csv",
  "application/x-ndjson",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/sql",
  "application/toml",
]);

/** Filename extensions that indicate text content when the MIME is unhelpful. */
const TEXT_EXTENSIONS =
  /\.(csv|tsv|txt|md|markdown|json|ndjson|xml|ya?ml|log|html?|js|ts|css|sql|ini|toml|tex)$/i;

/** Cap decoded text so a large upload can't blow the model's context window. */
const MAX_TEXT_CHARS = 200_000;

/**
 * Whether a file is UTF-8 text the model should read inline (CSV/JSON/XML/plain
 * text/…) rather than a binary attachment. Most models reject these as binary
 * "file" parts (e.g. "media type text/csv not supported"), and the agent wants
 * to read/parse the content anyway (e.g. parse a CSV → render_chart).
 */
function isTextLike(mime: string, fileName?: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (TEXT_APP_TYPES.has(mime)) return true;
  if (fileName && TEXT_EXTENSIONS.test(fileName)) return true;
  return false;
}

/**
 * Download a message's files and turn them into AG-UI content parts. Returns
 * the parts plus human-readable `notes` for anything skipped (appended to the
 * message as a text part by the caller).
 *
 * @param files      List of Telegram file references to process.
 * @param token      Telegram bot token used to build the download URL.
 * @param getFilePath  Resolves a fileId to a Telegram file path (e.g. via getFile API).
 * @param config     Optional delivery configuration.
 */
export async function buildFileContentParts(
  files: TelegramFileRef[],
  token: string,
  getFilePath: (fileId: string) => Promise<string>,
  config: FileDeliveryConfig = {},
): Promise<{ parts: AgentContentPart[]; notes: string[] }> {
  const maxBytes = config.maxBytesPerFile ?? DEFAULTS.maxBytesPerFile;
  const maxFiles = config.maxFiles ?? DEFAULTS.maxFiles;

  const parts: AgentContentPart[] = [];
  const notes: string[] = [];
  const considered = files.slice(0, maxFiles);
  if (files.length > maxFiles) {
    notes.push(
      `(only the first ${maxFiles} of ${files.length} files processed)`,
    );
  }

  for (const f of considered) {
    const label = f.fileName ?? f.fileId;
    const mime = (f.mimeType ?? "application/octet-stream").toLowerCase();

    if (typeof f.size === "number" && f.size > maxBytes) {
      notes.push(
        `skipped "${label}": ${f.size} bytes too large (cap is ${maxBytes} bytes)`,
      );
      continue;
    }

    let filePath: string;
    try {
      filePath = await getFilePath(f.fileId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(
        `skipped "${label}": could not resolve file path — ${redactToken(msg, token)}`,
      );
      continue;
    }

    const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
    let bytes: Buffer;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        notes.push(`skipped "${label}": download failed (HTTP ${res.status})`);
        continue;
      }

      // Pre-check Content-Length to avoid buffering oversized responses entirely
      // into memory (memory-DoS guard for cases where f.size is absent, e.g. photos).
      const contentLength = res.headers.get("content-length");
      if (contentLength !== null) {
        const declared = parseInt(contentLength, 10);
        if (!isNaN(declared) && declared > maxBytes) {
          notes.push(
            `skipped "${label}": Content-Length ${declared} bytes too large (cap is ${maxBytes} bytes)`,
          );
          continue;
        }
      }

      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`skipped "${label}": ${redactToken(msg, token)}`);
      continue;
    }

    // Backstop: reject if actual body exceeds cap (covers responses without Content-Length).
    if (bytes.byteLength > maxBytes) {
      notes.push(
        `skipped "${label}": ${bytes.byteLength} bytes too large (cap is ${maxBytes} bytes)`,
      );
      continue;
    }

    // Text-like files become a decoded TEXT part (the model can't take them as
    // binary "file" parts, and the agent wants to read/parse the content).
    if (isTextLike(mime, f.fileName)) {
      let text = bytes.toString("utf8");
      let truncated = "";
      if (text.length > MAX_TEXT_CHARS) {
        truncated = ` [truncated to ${MAX_TEXT_CHARS} of ${text.length} chars]`;
        text = text.slice(0, MAX_TEXT_CHARS);
      }
      parts.push({
        type: "text",
        text: `Attached file "${label}" (${mime})${truncated}:\n\n${text}`,
      });
      continue;
    }

    const partType = mediaPartType(mime);
    parts.push({
      type: partType,
      source: {
        type: "data",
        value: bytes.toString("base64"),
        mimeType: mime,
      },
    });
  }

  return { parts, notes };
}
