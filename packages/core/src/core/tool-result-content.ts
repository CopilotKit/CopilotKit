import type { ContentPart } from "@ag-ui/client";

/**
 * Single authority for the forwarded-to-client sentinel used by StateManager
 * and RunHandler.
 */
export const FORWARDED_TO_CLIENT = "Forwarded to client";

export function normalizeToolResultContent(content: unknown): string | null {
  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .flatMap((part) => {
        if (typeof part === "string") return [part];
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return [(part as { text: string }).text];
        }
        return [];
      })
      .join("")
      .trim();
    return text.length > 0 ? text : null;
  }

  if (
    content &&
    typeof content === "object" &&
    "text" in content &&
    typeof (content as { text?: unknown }).text === "string"
  ) {
    return (content as { text: string }).text.trim();
  }

  return null;
}

export function isForwardedToClientPlaceholder(content: unknown): boolean {
  return normalizeToolResultContent(content) === FORWARDED_TO_CLIENT;
}

const MEDIA_PART_TYPES = new Set(["image", "audio", "video", "document"]);

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isPartSource(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (typeof source.value !== "string") return false;
  switch (source.type) {
    case "data":
      return typeof source.mimeType === "string";
    case "url":
      return isOptionalString(source.mimeType);
    case "file":
      return (
        isOptionalString(source.provider) && isOptionalString(source.mimeType)
      );
    default:
      return false;
  }
}

/**
 * Mirrors `ContentPartSchema` from `@ag-ui/core/schemas`. The runtime parses
 * the request with that schema, and one invalid part there fails the whole run.
 * Core does not import the schema because the UMD build has no global for it.
 * A test checks this function against the schema.
 */
export function isContentPart(value: unknown): value is ContentPart {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const part = value as Record<string, unknown>;
  if (!isOptionalString(part.id) || part.metadata === null) return false;
  if (part.type === "text") return typeof part.text === "string";
  return (
    typeof part.type === "string" &&
    MEDIA_PART_TYPES.has(part.type) &&
    isPartSource(part.source)
  );
}

/**
 * Converts what a frontend tool handler returned into tool message content.
 * A non-empty array of AG-UI content parts passes through unchanged, so an
 * image reaches the model as media. Everything else becomes a string, as before.
 *
 * `text` is the string form, for surfaces typed as `result: string`
 * (`runTool`, `onToolExecutionEnd`). For content parts it is the JSON text they
 * received before. It is computed here, so a part that cannot be serialized
 * throws inside the caller's handler error boundary.
 */
export function toToolResultContent(result: unknown): {
  content: string | ContentPart[];
  text: string;
} {
  if (result === undefined || result === null) return { content: "", text: "" };
  if (typeof result === "string") return { content: result, text: result };
  const text = JSON.stringify(result);
  if (
    Array.isArray(result) &&
    result.length > 0 &&
    result.every(isContentPart)
  ) {
    return { content: result, text };
  }
  return { content: text, text };
}
