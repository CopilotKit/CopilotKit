import type { AgentContentPart } from "@copilotkit/channels-ui";
import type { ManagedFileRef } from "./contracts.js";

/** Map a MIME type to its `AgentContentPart` media kind, or null for non-media. */
export function mediaKindForMime(
  mime: string,
): "image" | "audio" | "video" | "document" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "document";
  return null;
}

/**
 * Hydrate file refs into `AgentContentPart`s: fetch each file's bytes via the
 * given fetcher and base64-encode them. Best-effort per file — a fetch failure
 * is logged and degraded to a short "could not be retrieved" note, never thrown
 * (the caller's turn must not fail because one attachment couldn't be fetched).
 * Media (image/audio/video/pdf) becomes a `data` part; `text/*` is decoded
 * inline; anything else degrades to a short text note so the model still sees
 * it.
 *
 * Shared by the inbound turn path ({@link IntelligenceAdapter.dispatchTo}, via
 * `buildContentParts`) and conversation-history seeding
 * (`HttpDeliverySource.getHistory`) so both hydrate files identically — a
 * historical image attachment and a live one produce the same content part.
 */
export async function buildContentParts(
  files: ManagedFileRef[] | undefined,
  fetchFile:
    | ((handle: string) => Promise<{ bytes: Uint8Array; mimeType?: string }>)
    | undefined,
  log?: (msg: string, meta?: unknown) => void,
): Promise<AgentContentPart[]> {
  if (!files?.length || !fetchFile) return [];
  const parts: AgentContentPart[] = [];
  for (const ref of files) {
    try {
      const { bytes, mimeType } = await fetchFile(ref.handle);
      // The typed ref's mime is authoritative — the file-serve route coerces
      // its Content-Type to a safe allowlist, so the header can be lossy.
      const mime = ref.mimeType ?? mimeType ?? "application/octet-stream";
      const kind = mediaKindForMime(mime);
      if (kind) {
        const value = Buffer.from(bytes).toString("base64");
        parts.push({
          type: kind,
          source: { type: "data", value, mimeType: mime },
        });
      } else if (mime.startsWith("text/")) {
        parts.push({
          type: "text",
          text: Buffer.from(bytes).toString("utf8"),
        });
      } else {
        parts.push({
          type: "text",
          text: `[attached file: ${ref.filename} (${mime})]`,
        });
      }
    } catch (err) {
      log?.("intelligence file fetch failed", err);
      // Fail-visible, not fail-silent: the user attached a file the model
      // can't be shown, so surface a short note in context rather than
      // dropping it entirely (the model can acknowledge / ask to retry).
      parts.push({
        type: "text",
        text: `[attached file ${ref.filename} could not be retrieved]`,
      });
    }
  }
  return parts;
}
