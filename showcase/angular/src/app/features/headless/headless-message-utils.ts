import type { ShowcaseMessage } from "./headless-chat.types";

/** Extract displayable text without rendering arbitrary message payloads. */
export function messageText(message: ShowcaseMessage): string {
  return typeof message.content === "string" ? message.content : "";
}

/** Parse a tool call's object arguments while treating malformed input as empty. */
export function toolArguments(rawArguments: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(rawArguments);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
