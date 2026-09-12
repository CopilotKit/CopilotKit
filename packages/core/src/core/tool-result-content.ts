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
