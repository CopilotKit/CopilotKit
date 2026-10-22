/**
 * Inbound file transport for Teams. A Teams message can carry uploaded files;
 * this turns them into AG-UI multimodal content the agent's model can read —
 * images and PDFs as their respective binary parts, and text/CSV/JSON as
 * decoded `text` parts. This is what makes the "upload a CSV → get a chart"
 * flow work: the CSV arrives as text the model can parse before it calls a
 * render tool. Mirrors `@copilotkit/channels-slack`'s `buildFileContentParts`.
 *
 * Teams delivers files two ways, and we handle both:
 *   - Channel/chat file uploads arrive as an attachment of contentType
 *     `application/vnd.microsoft.teams.file.download.info`, whose `content`
 *     holds a pre-authenticated `downloadUrl` (no bearer token needed) plus a
 *     `fileType`. We download from `downloadUrl`.
 *   - Inline media (and the M365 Agents Playground) arrives as an attachment
 *     whose `contentType` is the media MIME and `contentUrl` is either a
 *     `data:` URI (decoded in-process) or an https URL (fetched directly).
 *
 * The bridge is transport-only: it delivers the bytes/text to the agent and
 * lets the app decide what to do with them. Anything it can't represent is
 * skipped with a short note so the agent knows a file was dropped and why.
 */
import { BlockList, isIP } from "node:net";
import type { AgentContentPart } from "@copilotkit/channels-ui";

/** The subset of a Teams `Attachment` we read (matches @microsoft/agents-activity). */
export interface TeamsAttachmentRef {
  contentType: string;
  contentUrl?: string;
  /** `file.download.info` attachments carry the real source here. */
  content?: unknown;
  name?: string;
}

/** The `content` payload Teams puts on a `file.download.info` attachment. */
interface FileDownloadInfo {
  downloadUrl?: string;
  fileType?: string;
  uniqueId?: string;
}

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

const TEAMS_FILE_DOWNLOAD_INFO =
  "application/vnd.microsoft.teams.file.download.info";

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/csv",
  "application/xml",
  "application/x-ndjson",
  "application/yaml",
]);

/** Map a filename extension to a MIME when the attachment doesn't give one. */
const EXT_MIME: Record<string, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  ndjson: "application/x-ndjson",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

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

/** Best-effort MIME from a filename's extension, or undefined if unknown. */
export function mimeFromName(name: string | undefined): string | undefined {
  const ext = name?.split(".").pop()?.toLowerCase();
  return ext ? EXT_MIME[ext] : undefined;
}

/**
 * Turn downloaded bytes into a single AG-UI content part, or a skip `note` when
 * the type is unsupported or the file exceeds the byte cap. Shared by the
 * attachment path (this module) and the Graph channel path (`graph-files.ts`)
 * so both classify and truncate identically.
 */
export function decodeFileBytes(
  label: string,
  mime: string,
  bytes: Buffer,
  config: FileDeliveryConfig = {},
): { part: AgentContentPart } | { note: string } {
  const maxBytes = config.maxBytesPerFile ?? DEFAULTS.maxBytesPerFile;
  const maxText = config.maxTextBytes ?? DEFAULTS.maxTextBytes;
  const media = mediaPartType(mime);
  if (!media && !isText(mime)) {
    return { note: `skipped "${label}" (${mime}): unsupported type` };
  }
  if (bytes.byteLength > maxBytes) {
    return {
      note: `skipped "${label}": ${bytes.byteLength} bytes exceeds the ${maxBytes}-byte cap`,
    };
  }
  if (media) {
    // Image/audio/video/PDF → a binary data part the model reads natively
    // (subject to its modality support). The bridge just delivers it.
    return {
      part: {
        type: media,
        source: {
          type: "data",
          value: bytes.toString("base64"),
          mimeType: mime,
        },
      },
    };
  }
  // Truncate the BYTES then decode — slicing the decoded string by character
  // index would corrupt multi-byte UTF-8 (and not actually bound the byte
  // length). toString drops any malformed trailing bytes.
  let buf = bytes;
  let truncated = false;
  if (buf.byteLength > maxText) {
    buf = buf.subarray(0, maxText);
    truncated = true;
  }
  return {
    part: {
      type: "text",
      text:
        `Attached file "${label}" (${mime}${truncated ? ", truncated" : ""}):\n` +
        buf.toString("utf8"),
    },
  };
}

/** A normalized, fetchable source resolved from a Teams attachment. */
interface ResolvedSource {
  url: string;
  mime: string;
  label: string;
}

/**
 * Resolve a Teams attachment to a single fetchable source (URL + MIME + label),
 * or null if it carries nothing we can download. `file.download.info` points at
 * its pre-authenticated `downloadUrl`; everything else uses `contentUrl`.
 */
function resolveSource(att: TeamsAttachmentRef): ResolvedSource | null {
  const label = att.name ?? "file";
  if (att.contentType === TEAMS_FILE_DOWNLOAD_INFO) {
    const info = (att.content ?? {}) as FileDownloadInfo;
    if (!info.downloadUrl) return null;
    const mime =
      mimeFromName(att.name) ??
      (info.fileType ? EXT_MIME[info.fileType.toLowerCase()] : undefined) ??
      "application/octet-stream";
    return { url: info.downloadUrl, mime, label };
  }
  if (!att.contentUrl) return null;
  // For media/text attachments the contentType IS the MIME; fall back to the
  // filename when it's a generic wrapper.
  const mime =
    att.contentType && att.contentType.includes("/")
      ? att.contentType.toLowerCase()
      : (mimeFromName(att.name) ?? "application/octet-stream");
  return { url: att.contentUrl, mime, label };
}

/** Loopback, private, link-local (cloud metadata), CGNAT and unspecified ranges. */
const BLOCKED_ADDRESSES = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(net, prefix, "ipv6");
}

/**
 * Attachment URLs come from the inbound activity, so only fetch https URLs
 * that don't name localhost or a private/link-local IP literal.
 * ponytail: checks the URL, not DNS; a public name resolving to a private
 * address still passes. Pin the resolved address if that matters.
 */
function assertFetchableUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("only https URLs are fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(host);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    (family !== 0 &&
      BLOCKED_ADDRESSES.check(host, family === 4 ? "ipv4" : "ipv6"))
  ) {
    throw new Error("refusing to fetch a local or private address");
  }
  return url;
}

const MAX_REDIRECTS = 5;

/**
 * Fetch a source's bytes, at most `maxBytes` of them. Decodes `data:` URIs
 * in-process; fetches https, re-checking every redirect hop.
 */
async function fetchBytes(url: string, maxBytes: number): Promise<Buffer> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma < 0) throw new Error("malformed data URI");
    const meta = url.slice(5, comma);
    const payload = url.slice(comma + 1);
    return meta.includes(";base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
  }
  let next = assertFetchableUrl(url);
  for (let hop = 0; ; hop++) {
    const res = await fetch(next, { redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      // Release the redirect's connection before the next hop.
      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      next = assertFetchableUrl(new URL(location, next).href);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`download failed (HTTP ${res.status})`);
    }
    return readCapped(res, maxBytes);
  }
}

/** Read a response body, aborting as soon as it exceeds `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const tooBig = () => new Error(`exceeds the ${maxBytes}-byte cap`);
  if (Number(res.headers.get("content-length")) > maxBytes) throw tooBig();
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(value);
  }
}

/**
 * Download a message's attachments and turn them into AG-UI content parts.
 * Returns the parts plus human-readable `notes` for anything skipped (appended
 * to the message as a text part by the caller).
 */
export async function buildFileContentParts(
  attachments: readonly TeamsAttachmentRef[],
  config: FileDeliveryConfig = {},
): Promise<{ parts: AgentContentPart[]; notes: string[] }> {
  const maxFiles = config.maxFiles ?? DEFAULTS.maxFiles;

  const parts: AgentContentPart[] = [];
  const notes: string[] = [];
  const considered = attachments.slice(0, maxFiles);
  if (attachments.length > maxFiles) {
    notes.push(
      `(only the first ${maxFiles} of ${attachments.length} files processed)`,
    );
  }

  for (const att of considered) {
    const source = resolveSource(att);
    if (!source) {
      // A file.download.info with no downloadUrl is a real drop we want to
      // surface; other contentTypes (Adaptive Cards, the text/html mention)
      // simply aren't files, so skip them quietly.
      if (att.contentType === TEAMS_FILE_DOWNLOAD_INFO) {
        notes.push(
          `skipped "${att.name ?? "file"}": file.download.info had no downloadUrl`,
        );
      }
      continue;
    }
    const { url, mime, label } = source;
    let bytes: Buffer;
    try {
      bytes = await fetchBytes(
        url,
        config.maxBytesPerFile ?? DEFAULTS.maxBytesPerFile,
      );
    } catch (err) {
      notes.push(`skipped "${label}": ${(err as Error).message}`);
      continue;
    }
    const decoded = decodeFileBytes(label, mime, bytes, config);
    if ("note" in decoded) notes.push(decoded.note);
    else parts.push(decoded.part);
  }

  return { parts, notes };
}
