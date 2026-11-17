/**
 * Keeps the attachments of user messages rendering after the agent sends a
 * messages snapshot. Agents return the user's attachments in different
 * shapes, and these three do not render well:
 *
 * - The same attachment twice, or a PDF tagged as an image, which renders a
 *   broken `<img>`. The LangGraph round trip does this.
 * - Legacy `binary` parts, which AG-UI 1.0 removed and the chat does not
 *   render. The Microsoft Agent Framework Python bridge sends them.
 * - The message text without its attachments. The Microsoft Agent Framework
 *   .NET agent sends this.
 *
 * Each repair leaves a snapshot without that problem as it is, so the same
 * code runs for every integration.
 *
 * Outgoing attachments go out as the composer builds them: modern `image`
 * and `document` parts. Do not add a legacy `binary` copy, because AG-UI 1.0
 * bridges reject the whole run with HTTP 422.
 */

import type { AgentSubscriber } from "@ag-ui/client";
import type { ContentPart, Message } from "@ag-ui/core";

type MediaPart = Exclude<ContentPart, { type: "text" }>;
type MediaType = MediaPart["type"];

// The legacy part shape that AG-UI 1.0 removed.
interface LegacyBinaryPart {
  type: "binary";
  mimeType?: string;
  data?: string;
  url?: string;
  id?: string;
}

function isLegacyBinaryPart(part: object): part is LegacyBinaryPart {
  return "type" in part && part.type === "binary";
}

function mediaTypeFor(mimeType: string): MediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

// The modern form of a legacy `binary` part. `undefined` for any other part,
// and for a legacy part that has nothing to render.
function fromLegacyBinary(part: object): MediaPart | undefined {
  if (!isLegacyBinaryPart(part)) return undefined;
  const mimeType = part.mimeType ?? "application/octet-stream";
  const type = mediaTypeFor(mimeType);
  if (part.data) {
    return { type, source: { type: "data", value: part.data, mimeType } };
  }
  if (part.url) {
    return { type, source: { type: "url", value: part.url, mimeType } };
  }
  if (part.id) {
    return { type, source: { type: "file", value: part.id, mimeType } };
  }
  return undefined;
}

// A PDF tagged as `image` renders a broken <img>. Image and document parts
// take their type from their MIME type.
function withTypeFromMimeType(part: MediaPart): MediaPart {
  const mimeType = part.source.mimeType;
  const isImageOrDocument = part.type === "image" || part.type === "document";
  if (!isImageOrDocument || mimeType === undefined) return part;
  const type = mediaTypeFor(mimeType);
  return type === part.type ? part : { ...part, type };
}

// The repaired parts of one user message, or `undefined` when none changed.
function repairParts(parts: ContentPart[]) {
  const seenSources = new Set<string>();
  const repaired: ContentPart[] = [];
  let changed = false;
  for (const part of parts) {
    const media = fromLegacyBinary(part) ?? part;
    if (media.type === "text") {
      repaired.push(media);
      continue;
    }
    if (seenSources.has(media.source.value)) {
      changed = true;
      continue;
    }
    seenSources.add(media.source.value);
    const retyped = withTypeFromMimeType(media);
    changed ||= retyped !== part;
    repaired.push(retyped);
  }
  return changed ? repaired : undefined;
}

// The messages with their user attachments repaired, or `undefined` when no
// message changed.
function repairUserMedia(messages: readonly Message[]) {
  let changed = false;
  const repaired = messages.map((message) => {
    if (message.role !== "user" || typeof message.content === "string") {
      return message;
    }
    const content = repairParts(message.content);
    if (content === undefined) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? repaired : undefined;
}

function hasMedia(parts: ContentPart[]) {
  return parts.some((part) => part.type !== "text");
}

// The snapshot, with the attachments that it dropped put back from the
// messages the chat holds. `undefined` when it dropped none.
function restoreDroppedMedia(
  current: readonly Message[],
  snapshot: readonly Message[],
) {
  const partsById = new Map<string, ContentPart[]>();
  for (const message of current) {
    if (message.role !== "user" || typeof message.content === "string") {
      continue;
    }
    if (hasMedia(message.content)) partsById.set(message.id, message.content);
  }

  let changed = false;
  const restored = snapshot.map((message) => {
    if (message.role !== "user" || typeof message.content !== "string") {
      return message;
    }
    const parts = partsById.get(message.id);
    if (parts === undefined) return message;
    changed = true;
    return { ...message, content: parts };
  });
  return changed ? restored : undefined;
}

/**
 * The agent subscriber that runs the repairs:
 *
 * - On a messages snapshot that dropped attachments the chat holds, it
 *   applies the snapshot itself, with them put back, and stops the default
 *   snapshot handling. Any other snapshot gets the default handling.
 * - When a run ends, it repairs the attachments of every user message.
 *
 * Subscribe it with `agent.subscribe(attachmentRepair)`.
 */
export const attachmentRepair = {
  onMessagesSnapshotEvent({ event, messages }) {
    const restored = restoreDroppedMedia(messages, event.messages);
    if (restored === undefined) return undefined;
    return {
      messages: repairUserMedia(restored) ?? restored,
      stopPropagation: true,
    };
  },
  onRunFinalized({ messages }) {
    const repaired = repairUserMedia(messages);
    if (repaired === undefined) return undefined;
    return { messages: repaired };
  },
} satisfies AgentSubscriber;
