export interface SampleSpec {
  readonly buttonLabel: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly testId: string;
  readonly fetchUrl: string;
  readonly autoPrompt: string;
}

export interface MediaAgentMessage {
  readonly id?: string;
  readonly role: string;
  readonly content?: readonly unknown[];
}

/** Exact backend weather-tool spellings supported by the voice demo. */
export const VOICE_WEATHER_TOOL_NAMES = ["get_weather", "get-weather"] as const;

const MAGIC_BYTES: Readonly<Record<string, readonly number[]>> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
};

const LFS_POINTER_PREFIX = "version https://git-lfs";

/** Validate that a bundled media sample is a real supported asset. */
export function validateSampleBytes(
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): void {
  const asciiHead = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.slice(0, Math.min(bytes.length, 64)),
  );
  if (asciiHead.startsWith(LFS_POINTER_PREFIX)) {
    throw new Error(
      `Sample "${filename}" is a Git LFS pointer, not the real asset.`,
    );
  }
  const prefix = MAGIC_BYTES[mimeType];
  if (prefix && !bytesStartWith(bytes, prefix)) {
    throw new Error(
      `Sample "${filename}" does not have a valid ${mimeType} signature.`,
    );
  }
}

/** Build the canonical modern AG-UI content-parts message for a sample. */
export function createMultimodalMessage(
  spec: Pick<SampleSpec, "filename" | "mimeType" | "autoPrompt">,
  base64: string,
  size: number,
  id: string,
): MediaAgentMessage {
  return {
    id,
    role: "user",
    content: [
      { type: "text", text: spec.autoPrompt },
      {
        type: spec.mimeType === "application/pdf" ? "document" : "image",
        source: {
          type: "data",
          value: base64,
          mimeType: spec.mimeType,
        },
        metadata: { filename: spec.filename, size },
      },
    ],
  };
}

/** Append legacy binary mirrors needed by the published LangGraph converter. */
export function rewriteMessagesForLegacyConverter(
  messages: ReadonlyArray<Readonly<MediaAgentMessage>>,
): MediaAgentMessage[] | null {
  let mutated = false;
  const next = messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.content)) {
      return message as MediaAgentMessage;
    }
    const existingBinaryKeys = new Set<string>();
    for (const part of message.content) {
      if (!isRecord(part) || part["type"] !== "binary") continue;
      existingBinaryKeys.add(
        `${stringValue(part["mimeType"])}::${stringValue(part["data"] ?? part["url"])}`,
      );
    }
    const content: unknown[] = [];
    let messageMutated = false;
    for (const part of message.content) {
      content.push(part);
      const mirror = legacyBinaryFor(part);
      if (!mirror) continue;
      const key = `${mirror.mimeType}::${mirror.data ?? mirror.url ?? ""}`;
      if (existingBinaryKeys.has(key)) continue;
      existingBinaryKeys.add(key);
      content.push(mirror);
      messageMutated = true;
    }
    if (!messageMutated) return message as MediaAgentMessage;
    mutated = true;
    return { ...message, content };
  });
  return mutated ? next : null;
}

/** Normalize and deduplicate media that round-trips through LangGraph. */
export function dedupeUserMessageMedia(
  messages: ReadonlyArray<Readonly<MediaAgentMessage>>,
): MediaAgentMessage[] | null {
  let mutated = false;
  const next = messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.content)) {
      return message as MediaAgentMessage;
    }
    const seen = new Set<string>();
    const content: unknown[] = [];
    let messageMutated = false;
    for (const part of message.content) {
      if (!isRecord(part) || !isModernMediaType(part["type"])) {
        content.push(part);
        continue;
      }
      const source = isRecord(part["source"]) ? part["source"] : undefined;
      const sourceValue = stringValue(source?.["value"] ?? source?.["url"]);
      if (sourceValue && seen.has(sourceValue)) {
        messageMutated = true;
        continue;
      }
      if (sourceValue) seen.add(sourceValue);
      const mimeType = stringValue(source?.["mimeType"] ?? part["mimeType"]);
      const normalizedType = normalizePartType(part["type"], mimeType);
      if (normalizedType !== part["type"]) {
        content.push({ ...part, type: normalizedType });
        messageMutated = true;
      } else {
        content.push(part);
      }
    }
    if (!messageMutated) return message as MediaAgentMessage;
    mutated = true;
    return { ...message, content };
  });
  return mutated ? next : null;
}

/** Return whether bytes begin with an exact signature. */
function bytesStartWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

/** Mirror one modern media part in the legacy converter representation. */
function legacyBinaryFor(
  part: unknown,
): { type: "binary"; mimeType: string; data?: string; url?: string } | null {
  if (!isRecord(part) || !isModernMediaType(part["type"])) return null;
  const source = part["source"];
  if (!isRecord(source)) return null;
  const value = stringValue(source["value"]);
  if (!value) return null;
  const mimeType =
    stringValue(source["mimeType"]) || "application/octet-stream";
  if (source["type"] === "data") {
    return { type: "binary", mimeType, data: value };
  }
  if (source["type"] === "url") {
    return { type: "binary", mimeType, url: value };
  }
  return null;
}

/** Derive the rendered media type from the authoritative MIME type. */
function normalizePartType(type: string, mimeType: string): string {
  if (!mimeType) return type;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

/** Narrow an unknown discriminator to an AG-UI media part type. */
function isModernMediaType(value: unknown): value is string {
  return (
    value === "image" ||
    value === "document" ||
    value === "audio" ||
    value === "video"
  );
}

/** Narrow an unknown JSON value to an object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** Read a string or return the empty sentinel used in compound keys. */
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
