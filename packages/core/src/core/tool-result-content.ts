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

function isContentPart(value: unknown): value is ContentPart {
  if (!value || typeof value !== "object") return false;
  const part = value as { type?: unknown; text?: unknown; source?: unknown };
  if (part.type === "text") return typeof part.text === "string";
  if (typeof part.type !== "string" || !MEDIA_PART_TYPES.has(part.type)) {
    return false;
  }
  const source = part.source as { type?: unknown } | null | undefined;
  return (
    !!source && typeof source === "object" && typeof source.type === "string"
  );
}

/**
 * Converts what a frontend tool handler returned into tool message content.
 * A non-empty array of AG-UI content parts passes through unchanged, so an
 * image reaches the model as media. Everything else becomes a string, as before.
 */
export function toToolResultContent(result: unknown): string | ContentPart[] {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  if (
    Array.isArray(result) &&
    result.length > 0 &&
    result.every(isContentPart)
  ) {
    return result;
  }
  return JSON.stringify(result);
}

/**
 * The string form of tool message content. Content parts keep the JSON text
 * that string-typed surfaces (`runTool`, `onToolExecutionEnd`) received before.
 */
export function toolResultString(content: string | ContentPart[]): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}
